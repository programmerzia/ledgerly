<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;

/**
 * Customer and supplier statement: the contact's lines on the AR (customer) or AP (supplier) control accounts, read
 * from posted journal lines (the source of truth, so the closing balance IS the contact's control-account balance), with
 * an opening balance before `from`, then every line in date order with a running balance, in base currency. A customer
 * balance is debit - credit (what they owe); a supplier balance is credit - debit (what we owe). Reversed documents show
 * both their original and their reversal lines, so they net out. Each line carries the document number resolved from the
 * journal's source (credit applications use the journal's own reference, "credit / document").
 */
final class ContactStatement
{
    private const array LABELS = [
        'sales_invoice' => 'invoice', 'credit_note' => 'credit_note', 'purchase_bill' => 'bill', 'debit_note' => 'debit_note',
        'credit_application' => 'credit_application',
    ];

    public function __construct(private readonly ReportRunner $runner) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p, bool $customer): array
    {
        $contactId = $p->contactId ?? throw ValidationException::withMessages(['contact_id' => ['Give the contact_id.']]);
        $db = $this->runner->db();
        $contact = $db->selectOne('SELECT id, code, name, kind::text AS kind FROM contacts WHERE company_id = ? AND id = ?', [$p->companyId, $contactId])
            ?? throw ValidationException::withMessages(['contact_id' => ['The contact does not exist.']]);
        $control = $customer ? 'ar' : 'ap';
        $sign = $customer ? 1 : -1;
        $from = (string) $p->from;
        $cur = $p->currency;

        $opening = $sign * (int) ($db->selectOne(
            "SELECT COALESCE(SUM(l.debit - l.credit), 0) AS n FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
             WHERE l.company_id = ? AND l.contact_id = ? AND a.control_type::text = ? AND j.status IN ('posted', 'reversed') AND j.journal_date < ?",
            [$p->companyId, $contactId, $control, $from],
        )->n ?? 0);

        $lines = $db->select(
            "SELECT j.id AS journal_id, j.journal_date, j.number AS journal_number, j.source_type, j.source_id, j.reference, j.reversal_of_id, l.description, l.debit, l.credit,
                    i.number AS invoice_number, s.number AS settlement_number, s.kind::text AS settlement_kind
             FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
             LEFT JOIN invoices i ON i.id = j.source_id AND j.source_type = i.kind::text
             LEFT JOIN settlements s ON s.id = j.source_id AND j.source_type = 'settlement'
             WHERE l.company_id = ? AND l.contact_id = ? AND a.control_type::text = ? AND j.status IN ('posted', 'reversed') AND j.journal_date BETWEEN ? AND ?
             ORDER BY j.journal_date, j.posted_at, j.id, l.line_no",
            [$p->companyId, $contactId, $control, $from, $p->to],
        );

        $balance = $opening;
        $debits = 0;
        $credits = 0;
        $rows = [];
        foreach ($lines as $l) {
            $debit = (int) $l->debit;
            $credit = (int) $l->credit;
            $balance += $sign * ($debit - $credit);
            $debits += $debit;
            $credits += $credit;
            $type = (string) ($l->source_type ?? 'manual');
            $number = $l->invoice_number ?? $l->settlement_number ?? ($type === 'credit_application' ? $l->reference : null);
            $rows[] = [
                'date' => $l->journal_date,
                'type' => $l->reversal_of_id !== null ? 'reversal' : ($type === 'settlement' ? (string) $l->settlement_kind : (self::LABELS[$type] ?? $type)),
                'document' => ['type' => $type, 'id' => $l->source_id, 'number' => $number],
                'journal_id' => $l->journal_id,
                'journal_number' => $l->journal_number,
                'description' => $l->description,
                'debit' => Json::money($debit, $cur),
                'credit' => Json::money($credit, $cur),
                'balance' => Json::money($balance, $cur),
            ];
        }

        return [
            'report' => $customer ? 'customer_statement' : 'supplier_statement',
            'currency' => $cur,
            'contact' => ['id' => (string) $contact->id, 'code' => (string) $contact->code, 'name' => (string) $contact->name],
            'from' => $from,
            'to' => $p->to,
            'opening_balance' => Json::money($opening, $cur),
            'rows' => $rows,
            'totals' => ['debit' => Json::money($debits, $cur), 'credit' => Json::money($credits, $cur)],
            'closing_balance' => Json::money($balance, $cur),
        ];
    }
}
