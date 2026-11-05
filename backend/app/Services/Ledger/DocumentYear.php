<?php

declare(strict_types=1);

namespace App\Services\Ledger;

use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * Which yearly sequence a document without a posting date draws its number from (requisitions, orders, receipts; plan 3c.16a).
 *
 * A number reads `{prefix}-{fiscal year name}-{counter}` and a numbering rule is found by the fiscal year name in the sequence key
 * (SequenceAllocator / NumberingRules). These documents used the calendar year of their date, so for a fiscal year that is not the
 * calendar year, or is simply not *named* like it, a rule never applied. They now use the name of the fiscal year the date falls in.
 *
 * Nothing already issued changes and nothing is renumbered:
 *  - a sequence that already exists under the fiscal year's name keeps being used;
 *  - otherwise a sequence that already exists under the calendar year (the old key) keeps being used, so a year in progress carries on
 *    with the same prefix and counter, gapless;
 *  - otherwise (nothing issued yet) the fiscal year's name is used, and the numbering rule applies.
 * A date outside every fiscal year falls back to the calendar year, as before.
 */
final class DocumentYear
{
    /**
     * @param  string  $kind  a NumberingKinds key such as `purchase_order`
     * @return array{0: string, 1: string} the sequence key and the year text in the number
     */
    public function for(string $companyId, string $kind, DateTimeInterface $date): array
    {
        $day = $date->format('Y-m-d');
        $calendar = $date->format('Y');
        $fiscal = DB::table('fiscal_years')->where('company_id', $companyId)->where('starts_on', '<=', $day)->where('ends_on', '>=', $day)->value('name');
        if (! is_string($fiscal) || $fiscal === $calendar) {
            return ["doc:{$kind}:{$calendar}", $calendar];
        }

        $byFiscal = "doc:{$kind}:{$fiscal}";
        if ($this->exists($companyId, $byFiscal)) {
            return [$byFiscal, $fiscal];
        }
        $byCalendar = "doc:{$kind}:{$calendar}";
        if ($this->exists($companyId, $byCalendar)) {
            return [$byCalendar, $calendar];
        }

        return [$byFiscal, $fiscal];
    }

    private function exists(string $companyId, string $key): bool
    {
        return DB::table('sequences')->where('company_id', $companyId)->where('sequence_key', $key)->exists();
    }
}
