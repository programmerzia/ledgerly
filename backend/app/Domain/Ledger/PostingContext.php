<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

/** Everything the validator needs, loaded by the caller (locked period included). */
final readonly class PostingContext
{
    /**
     * @param  array<string, AccountInfo>  $accounts  accounts of the draft's company, by id
     * @param  array<string, DimensionValueInfo>  $dimensionValues  of the draft's company, by id
     */
    public function __construct(
        public string $baseCurrency,
        public array $accounts,
        public array $dimensionValues,
        public ?PeriodInfo $period,
        public bool $canPostSoftClosed = false,
        public bool $canPostAdjustment = false,
    ) {}
}
