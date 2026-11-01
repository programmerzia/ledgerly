<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use Illuminate\Support\Facades\DB;

/**
 * What contacts owe and are owed, from posted documents, in base currency. Receivable = open invoices less open
 * credit notes; payable = open bills (less withheld tax, which is not owed to the supplier) less open debit notes.
 * Either may be negative: a net credit balance. It is not netted against the other side (D9). Settlements (2.12)
 * move `settled`, so this follows them without change.
 */
final class ContactBalances
{
    /**
     * @param  list<string>  $contactIds
     * @return array<string, array{receivable: int, payable: int}> by contact id; contacts with no posted documents are absent
     */
    public function __invoke(string $companyId, array $contactIds): array
    {
        if ($contactIds === []) {
            return [];
        }

        $rows = DB::table('invoices')
            ->where('company_id', $companyId)->where('status', 'posted')->whereIn('contact_id', $contactIds)
            ->groupBy('contact_id')
            ->selectRaw(<<<'SQL'
                contact_id,
                COALESCE(SUM(CASE kind WHEN 'sales_invoice' THEN total - settled WHEN 'credit_note' THEN -(total - settled) ELSE 0 END), 0) AS receivable,
                COALESCE(SUM(CASE kind WHEN 'purchase_bill' THEN total - wht_amount - settled WHEN 'debit_note' THEN -(total - wht_amount - settled) ELSE 0 END), 0) AS payable
            SQL)
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row->contact_id] = ['receivable' => (int) $row->receivable, 'payable' => (int) $row->payable];
        }

        return $out;
    }
}
