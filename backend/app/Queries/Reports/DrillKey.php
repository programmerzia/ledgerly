<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/**
 * The drill key every numeric cell carries (13 §13): the arguments of `GET …/reports/drill` that list the
 * journal lines behind the cell. `exclude_closing` is set for profit and loss cells, which leave year-end
 * closing journals out (D7). `contact_side` selects, on a receivable or payable control account, the
 * contacts whose net balance is a debit or a credit (the gross presentation of D9).
 */
final class DrillKey
{
    /**
     * @param  array<string, list<string>>  $dimensions  dimension id → value ids
     * @return array<string, mixed>
     */
    public static function make(string $accountId, ?string $from, string $to, bool $excludeClosing, array $dimensions, ?string $contactSide = null, ?string $contactId = null): array
    {
        $key = ['account_id' => $accountId, 'from' => $from, 'to' => $to, 'exclude_closing' => $excludeClosing];
        if ($dimensions !== []) {
            $key['dimensions'] = $dimensions;
        }
        if ($contactSide !== null) {
            $key['contact_side'] = $contactSide;
        }
        if ($contactId !== null) {
            $key['contact_id'] = $contactId;
        }

        return $key;
    }
}
