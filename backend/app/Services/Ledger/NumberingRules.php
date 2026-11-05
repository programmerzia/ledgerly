<?php

declare(strict_types=1);

namespace App\Services\Ledger;

use App\Domain\Organisation\NumberingKinds;
use Illuminate\Database\Connection;

/**
 * Looks up the company's numbering rule when a year's sequence is about to be created (13 §23 D15 item 6). It is only asked then: a
 * sequence that already exists keeps the prefix and padding it was created with, so nothing issued is touched.
 */
final class NumberingRules
{
    /**
     * @param  string  $defaultPrefix  the caller's built-in prefix, `INV-FY2026-`, used when no rule applies
     * @return array{0: string, 1: int} prefix and padding for the new sequence
     */
    public function forNewSequence(Connection $db, string $tenantId, string $companyId, string $key, string $defaultPrefix, int $defaultPadding): array
    {
        $parsed = NumberingKinds::parseKey($key);
        if ($parsed === null) {
            return [$defaultPrefix, $defaultPadding];
        }
        [$kind, $yearName] = $parsed;
        $year = $db->selectOne('SELECT starts_on FROM fiscal_years WHERE tenant_id = ? AND company_id = ? AND name = ?', [$tenantId, $companyId, $yearName]);
        if ($year === null) {
            return [$defaultPrefix, $defaultPadding];
        }
        $rule = $db->selectOne(
            'SELECT prefix, padding FROM numbering_rules WHERE tenant_id = ? AND company_id = ? AND doc_kind = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
            [$tenantId, $companyId, $kind, (string) $year->starts_on],
        );
        if ($rule === null) {
            return [$defaultPrefix, $defaultPadding];
        }

        return [$rule->prefix.'-'.$yearName.'-', (int) $rule->padding];
    }
}
