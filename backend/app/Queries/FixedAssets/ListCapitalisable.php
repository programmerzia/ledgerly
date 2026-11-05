<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Domain\Trade\PostingSupport;
use App\Http\Support\Json;
use Illuminate\Support\Facades\DB;

/**
 * Posted lines on fixed asset accounts that are not yet in the register: the candidates for "capitalise". Bill lines are
 * net of discount and before tax; journal lines are the debit. Reversed documents are left out. Newest first, at most 200.
 */
final class ListCapitalisable
{
    /** @return list<array<string, mixed>> */
    public function __invoke(string $companyId, string $currency): array
    {
        $bills = DB::select(
            "SELECT l.id, i.number, i.issue_date AS date, l.line_no, l.description, l.account_id, a.code, a.name AS account_name,
                    (SELECT c.id FROM asset_categories c WHERE c.company_id = l.company_id AND c.asset_account_id = l.account_id ORDER BY c.name LIMIT 1) AS category_id,
                    l.line_total_fc, i.fx_rate, i.currency
               FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN accounts a ON a.id = l.account_id
              WHERE l.company_id = ? AND i.kind = 'purchase_bill' AND i.status = 'posted' AND a.control_type = 'fixed_asset'
                AND NOT EXISTS (SELECT 1 FROM fixed_assets f WHERE f.company_id = l.company_id AND f.source_type = 'bill_line' AND f.source_id = l.id)
              ORDER BY i.issue_date DESC, l.line_no LIMIT 200",
            [$companyId],
        );
        $journals = DB::select(
            "SELECT l.id, j.number, j.journal_date AS date, l.line_no, l.description, l.account_id, a.code, a.name AS account_name, j.id AS journal_id, l.debit,
                    (SELECT c.id FROM asset_categories c WHERE c.company_id = l.company_id AND c.asset_account_id = l.account_id ORDER BY c.name LIMIT 1) AS category_id
               FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE l.company_id = ? AND j.status = 'posted' AND j.journal_type NOT IN ('purchase') AND a.control_type = 'fixed_asset' AND l.debit > 0
                AND NOT EXISTS (SELECT 1 FROM fixed_assets f WHERE f.company_id = l.company_id AND f.source_type = 'journal_line' AND f.source_id = l.id)
              ORDER BY j.journal_date DESC, l.line_no LIMIT 200",
            [$companyId],
        );

        $out = [];
        foreach ($bills as $b) {
            $out[] = [
                'source_type' => 'bill_line', 'source_id' => (string) $b->id, 'document_number' => (string) $b->number, 'date' => substr((string) $b->date, 0, 10),
                'line_no' => (int) $b->line_no, 'description' => $b->description === null ? null : (string) $b->description, 'account_id' => (string) $b->account_id, 'account_code' => (string) $b->code,
                'account_name' => (string) $b->account_name, 'category_id' => $b->category_id === null ? null : (string) $b->category_id,
                'amount' => Json::money(PostingSupport::toBase((int) $b->line_total_fc, (string) $b->fx_rate), $currency),
            ];
        }
        foreach ($journals as $j) {
            $out[] = [
                'source_type' => 'journal_line', 'source_id' => (string) $j->id, 'document_number' => (string) $j->number, 'date' => substr((string) $j->date, 0, 10),
                'line_no' => (int) $j->line_no, 'description' => $j->description === null ? null : (string) $j->description, 'account_id' => (string) $j->account_id, 'account_code' => (string) $j->code,
                'account_name' => (string) $j->account_name, 'category_id' => $j->category_id === null ? null : (string) $j->category_id, 'amount' => Json::money((int) $j->debit, $currency),
            ];
        }
        usort($out, static fn (array $a, array $b): int => strcmp((string) $b['date'], (string) $a['date']));

        return $out;
    }
}
