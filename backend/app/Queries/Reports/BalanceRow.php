<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/** Debit and credit totals of one account, optionally of one value of the grouping dimension. */
final readonly class BalanceRow
{
    public function __construct(public string $accountId, public ?string $group, public int $debit, public int $credit) {}
}
