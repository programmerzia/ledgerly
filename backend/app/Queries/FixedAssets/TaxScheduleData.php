<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/**
 * The tax depreciation schedule: for every asset with a tax class, its allowance and tax written-down value in each year; and the
 * same added up by year. A report only: nothing in it is, or becomes, a ledger entry.
 */
final readonly class TaxScheduleData
{
    /**
     * @param  list<TaxScheduleAsset>  $assets
     * @param  list<TaxScheduleYear>  $byYear
     */
    public function __construct(public array $assets, public array $byYear) {}
}
