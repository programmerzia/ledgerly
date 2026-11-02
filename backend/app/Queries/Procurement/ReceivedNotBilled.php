<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Procurement\Quantity;
use App\Domain\Trade\LineAmount;
use App\Domain\Trade\PostingSupport;
use Illuminate\Database\ConnectionInterface;

/**
 * What a manual month-end accrual is worked out from (D14). As of a date: quantity received, less quantity on posted bills,
 * valued net of tax at the order line's price and converted at the order's rate. It answers what the ledger did not know
 * on that date, so a receipt reversed later still counts, a pending bill does not reduce it (nothing is in the ledger yet),
 * and a bill reversed later still does. A line billed beyond what was received (an override) shows nothing.
 */
final class ReceivedNotBilled
{
    public function __construct(private readonly ConnectionInterface $db) {}

    /** @return array{as_of: string, rows: list<array{purchase_order_id: string, number: string|null, contact_id: string, contact_name: string, order_line_id: string, line_no: int, description: string|null, account_id: string, account_code: string, account_name: string, received: string, billed: string, unbilled: string, currency: string, fx_rate: string, unbilled_fc: int, unbilled_base: int}>, total_base: int} */
    public function __invoke(string $companyId, string $asOf, ?string $contactId = null): array
    {
        $rows = $this->db->select(
            <<<'SQL'
            SELECT o.id AS order_id, o.number, o.contact_id, c.name AS contact_name, o.currency, o.fx_rate::text AS fx_rate,
                   l.id AS line_id, l.line_no, l.description, l.account_id, a.code AS account_code, a.name AS account_name, l.unit_price_fc,
                   COALESCE((SELECT SUM(g.quantity) FROM goods_receipt_lines g JOIN goods_receipts r ON r.id = g.goods_receipt_id
                      WHERE g.purchase_order_line_id = l.id AND r.receipt_date <= ?::date
                        AND (r.status = 'recorded' OR r.reversed_at::date > ?::date)), 0)::text AS received,
                   COALESCE((SELECT SUM(il.quantity) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                      LEFT JOIN journals rj ON rj.id = i.reversal_journal_id
                      WHERE il.purchase_order_line_id = l.id AND i.kind = 'purchase_bill' AND i.issue_date <= ?::date
                        AND (i.status = 'posted' OR (i.status = 'reversed' AND rj.journal_date > ?::date))), 0)::text AS billed
            FROM purchase_order_lines l
            JOIN purchase_orders o ON o.id = l.purchase_order_id
            JOIN contacts c ON c.id = o.contact_id
            JOIN accounts a ON a.id = l.account_id
            WHERE o.company_id = ?::uuid AND o.status IN ('approved', 'partly_received', 'received', 'closed') AND (?::uuid IS NULL OR o.contact_id = ?::uuid)
            ORDER BY c.name, o.number, l.line_no
            SQL,
            [$asOf, $asOf, $asOf, $asOf, $companyId, $contactId, $contactId],
        );

        $out = [];
        foreach ($rows as $row) {
            $unbilled = Quantity::remaining((string) $row->received, (string) $row->billed);
            if (Quantity::isZero($unbilled)) {
                continue;
            }
            $fc = LineAmount::net($unbilled, (int) $row->unit_price_fc);
            $out[] = [
                'purchase_order_id' => (string) $row->order_id, 'number' => $row->number === null ? null : (string) $row->number,
                'contact_id' => (string) $row->contact_id, 'contact_name' => (string) $row->contact_name,
                'order_line_id' => (string) $row->line_id, 'line_no' => (int) $row->line_no, 'description' => $row->description === null ? null : (string) $row->description,
                'account_id' => (string) $row->account_id, 'account_code' => (string) $row->account_code, 'account_name' => (string) $row->account_name,
                'received' => Quantity::normal((string) $row->received), 'billed' => Quantity::normal((string) $row->billed), 'unbilled' => $unbilled,
                'currency' => (string) $row->currency, 'fx_rate' => (string) $row->fx_rate,
                'unbilled_fc' => $fc, 'unbilled_base' => PostingSupport::toBase($fc, (string) $row->fx_rate),
            ];
        }

        return ['as_of' => $asOf, 'rows' => $out, 'total_base' => array_sum(array_column($out, 'unbilled_base'))];
    }
}
