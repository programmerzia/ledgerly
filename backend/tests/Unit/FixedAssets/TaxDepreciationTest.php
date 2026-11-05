<?php

declare(strict_types=1);

use App\Domain\FixedAssets\TaxDepreciation;

it('takes the first-year rate in year one, then equal instalments on cost until written off', function (): void {
    // 120,000.00 at 10% a year with a 50% first year: 60,000.00, then 12,000.00 for five years.
    $rows = TaxDepreciation::schedule(12000000, 1000, 5000);

    expect(array_column($rows, 'allowance'))->toBe([6000000, 1200000, 1200000, 1200000, 1200000, 1200000])
        ->and(array_column($rows, 'written_down'))->toBe([6000000, 4800000, 3600000, 2400000, 1200000, 0]);
});

it('uses the annual rate in year one when there is no first-year rate', function (): void {
    expect(array_column(TaxDepreciation::schedule(1000000, 2500, null), 'allowance'))->toBe([250000, 250000, 250000, 250000]);
});

it('rounds each year half up and lets the last year take the remainder, so the cost is written off exactly', function (): void {
    // 1,000 at 33.33% a year: 333 (333.3), 333, 333, then the 1 left.
    $rows = TaxDepreciation::schedule(1000, 3333, null);

    expect(array_column($rows, 'allowance'))->toBe([333, 333, 333, 1])->and(array_sum(array_column($rows, 'allowance')))->toBe(1000)
        ->and(end($rows)['written_down'])->toBe(0);
});

it('writes off in one year when the first-year rate is 100%, and never goes below nothing', function (): void {
    expect(TaxDepreciation::schedule(500, 2000, 10000))->toBe([['year_index' => 0, 'allowance' => 500, 'written_down' => 0]]);
    expect(array_column(TaxDepreciation::schedule(500, 6000, null), 'allowance'))->toBe([300, 200]);
});

it('stops rather than loop when a rate is too small to reach a minor unit', function (): void {
    expect(TaxDepreciation::schedule(10, 1, null))->toBe([]);
});
