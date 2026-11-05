<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use Illuminate\Support\Facades\DB;

/**
 * Customers with a balance for the statement run (plan 3c.7a): the contact's balance on the receivable control accounts up to a
 * date, read from posted journal lines exactly as the statement itself does (so the list and the statement agree). A customer
 * who owes nothing and is owed nothing is not listed; a credit balance is (negative) because the customer may want to see it.
 * Soft-deleted and supplier-only contacts are never listed.
 */
final class StatementRunCustomers
{
    /**
     * @return list<array{id: string, code: string, name: string, email: string|null, balance: int, last_sent_at: string|null}>
     */
    public function __invoke(string $companyId, string $to, ?string $onlyContact = null): array
    {
        $rows = DB::select(
            "SELECT c.id, c.code, c.name, NULLIF(trim(COALESCE(c.email, '')), '') AS email, b.balance,
                    (SELECT MAX(s.queued_at) FROM document_sends s WHERE s.company_id = c.company_id AND s.document_type = 'statement'
                       AND s.contact_id = c.id AND s.status IN ('queued', 'sent')) AS last_sent_at
             FROM (
               SELECT l.contact_id, SUM(l.debit - l.credit) AS balance
               FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
               WHERE l.company_id = ? AND a.control_type::text = 'ar' AND l.contact_id IS NOT NULL
                 AND j.status IN ('posted', 'reversed') AND j.journal_date <= ?
               GROUP BY l.contact_id HAVING SUM(l.debit - l.credit) <> 0
             ) b JOIN contacts c ON c.id = b.contact_id
             WHERE c.company_id = ? AND c.deleted_at IS NULL AND c.kind::text IN ('customer', 'both') AND (?::uuid IS NULL OR c.id = ?::uuid)
             ORDER BY lower(c.name), c.id",
            [$companyId, $to, $companyId, $onlyContact, $onlyContact],
        );

        return array_values(array_map(function (object $r): array {
            $row = (array) $r;

            return [
                'id' => (string) $row['id'], 'code' => (string) $row['code'], 'name' => (string) $row['name'],
                'email' => $row['email'] === null ? null : (string) $row['email'],
                'balance' => (int) $row['balance'],
                'last_sent_at' => $row['last_sent_at'] === null ? null : (string) $row['last_sent_at'],
            ];
        }, $rows));
    }
}
