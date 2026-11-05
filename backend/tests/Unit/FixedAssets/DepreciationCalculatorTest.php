<?php

declare(strict_types=1);

use App\Domain\FixedAssets\AssetState;
use App\Domain\FixedAssets\DepreciationCalculator;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Domain\Shared\DomainRuleViolation;

function assetState(array $o = []): AssetState
{
    return new AssetState(
        $o['cost'] ?? 12000000, $o['residual'] ?? 0, $o['dep'] ?? 0, $o['imp'] ?? 0, $o['method'] ?? DepreciationMethod::StraightLine,
        array_key_exists('life', $o) ? $o['life'] : 120, $o['rate'] ?? null, $o['unitsTotal'] ?? null, $o['unitsUsed'] ?? 0, $o['charged'] ?? 0,
        $o['from'] ?? '2026-03-20', $o['through'] ?? null, $o['depreciable'] ?? true, $o['disposed'] ?? false, $o['cf'] ?? null,
    );
}

/** Runs every month from the first due through $until and applies each charge, as consecutive runs would. @return list<int> */
function runSchedule(AssetState $s, string $until): array
{
    $out = [];
    foreach (DepreciationCalculator::monthsDue($s, $until) as $month) {
        if (DepreciationCalculator::monthsDue($s, $month) === []) {
            break;
        }
        $c = DepreciationCalculator::charge($s, [$month]);
        $out[] = $c->amount;
        $s = new AssetState(
            $s->cost, $s->residual, $s->accumulatedDepreciation + $c->amount, $s->accumulatedImpairment, $s->method, $s->lifeMonths, $s->decliningRateBp,
            $s->unitsTotal, $s->unitsUsed, $c->newMonthsCharged, $s->availableFrom, $c->through,
        );
    }

    return $out;
}

it('charges a full month for the month the asset becomes available: 120,000.00 over 10 years bought 20 March', function (): void {
    $s = assetState();
    $months = DepreciationCalculator::monthsDue($s, '2026-03-31');
    $c = DepreciationCalculator::charge($s, $months);

    expect($months)->toBe(['2026-03-31'])->and($c->amount)->toBe(100000)->and($c->schedule)->toBe([['month_end' => '2026-03-31', 'amount' => 100000]])
        ->and($c->newMonthsCharged)->toBe(1)->and($c->through)->toBe('2026-03-31')->and($c->newCarrying)->toBe(11900000);
    // Nothing is due before the month it is available, and nothing twice.
    expect(DepreciationCalculator::monthsDue($s, '2026-02-28'))->toBe([])
        ->and(DepreciationCalculator::monthsDue(assetState(['through' => '2026-03-31', 'charged' => 1, 'dep' => 100000]), '2026-03-31'))->toBe([]);
});

it('ends exactly at cost less residual, the last month taking the rounding: 1,000 less 100 over 7 months', function (): void {
    $series = runSchedule(assetState(['cost' => 1000, 'residual' => 100, 'life' => 7, 'from' => '2026-01-05']), '2026-12-31');

    // 900/7=128.57->129; 771/6=128.5->129; 642/5=128.4->128; 514/4=128.5->129; 385/3=128.33->128; 257/2=128.5->129; last 128.
    expect($series)->toBe([129, 129, 128, 129, 128, 129, 128])->and(array_sum($series))->toBe(900);
});

it('divides evenly when it can: 120,000.00 over 120 months is 1,000.00 every month and 120,000.00 in all', function (): void {
    $series = runSchedule(assetState(), '2036-12-31');

    expect($series)->toHaveCount(120)->and(array_unique($series))->toBe([100000])->and(array_sum($series))->toBe(12000000);
});

it('catches up months that were skipped and says how many', function (): void {
    $s = assetState(['from' => '2026-01-10']);
    $months = DepreciationCalculator::monthsDue($s, '2026-03-31');
    $c = DepreciationCalculator::charge($s, $months);

    expect($months)->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])->and($c->amount)->toBe(300000)->and($c->catchUpMonths('2026-03-31'))->toBe(2)
        ->and(array_column($c->schedule, 'amount'))->toBe([100000, 100000, 100000]);
});

it('charges declining balance on the carrying amount, never below the residual value', function (): void {
    // 20% a year = 2000 basis points; monthly = carrying x 2000 / 120000 = carrying / 60.
    $s = assetState(['cost' => 1200000, 'residual' => 200000, 'method' => DepreciationMethod::DecliningBalance, 'rate' => 2000, 'life' => null]);
    $series = runSchedule($s, '2026-06-30');

    // 1,200,000/60 = 20,000; 1,180,000/60 = 19,666.67 -> 19,667; 1,160,333/60 = 19,338.88 -> 19,339.
    expect(array_slice($series, 0, 3))->toBe([20000, 19667, 19339]);

    $near = assetState(['cost' => 1200000, 'residual' => 1199990, 'method' => DepreciationMethod::DecliningBalance, 'rate' => 2000, 'life' => null]);
    expect(DepreciationCalculator::charge($near, DepreciationCalculator::monthsDue($near, '2026-03-31'))->amount)->toBe(10);

    $atFloor = assetState(['cost' => 1200000, 'residual' => 1200000, 'method' => DepreciationMethod::DecliningBalance, 'rate' => 2000, 'life' => null]);
    expect(DepreciationCalculator::monthsDue($atFloor, '2026-03-31'))->toBe([]);
});

it('does not overflow on large amounts at a declining rate', function (): void {
    $s = assetState(['cost' => 9_000_000_000_000_000, 'method' => DepreciationMethod::DecliningBalance, 'rate' => 10000, 'life' => null]);

    expect(DepreciationCalculator::charge($s, DepreciationCalculator::monthsDue($s, '2026-03-31'))->amount)->toBe(750_000_000_000_000);
});

it('depreciates by units: 100,000 units expected, the run using the last units takes the remainder', function (): void {
    $s = assetState(['cost' => 1000000, 'residual' => 100000, 'method' => DepreciationMethod::UnitsOfProduction, 'life' => null, 'unitsTotal' => 100000]);
    $m = DepreciationCalculator::monthsDue($s, '2026-03-31');
    $first = DepreciationCalculator::charge($s, $m, 12345);

    // 900,000 x 12,345 / 100,000 = 111,105.
    expect($first->amount)->toBe(111105)->and($first->units)->toBe(12345);

    $late = assetState(['cost' => 1000000, 'residual' => 100000, 'method' => DepreciationMethod::UnitsOfProduction, 'life' => null, 'unitsTotal' => 100000, 'unitsUsed' => 87655, 'dep' => 788895, 'through' => '2026-02-28']);
    $last = DepreciationCalculator::charge($late, DepreciationCalculator::monthsDue($late, '2026-03-31'), 12345);
    expect($last->amount)->toBe(111105)->and($last->newCarrying)->toBe(100000);

    expect(fn () => DepreciationCalculator::charge($s, $m, 100001))->toThrow(DomainRuleViolation::class);
});

it('never depreciates land, a disposed asset, or an asset at its residual value', function (): void {
    foreach ([['depreciable' => false], ['disposed' => true], ['dep' => 12000000]] as $o) {
        expect(DepreciationCalculator::monthsDue(assetState($o), '2026-12-31'))->toBe([]);
    }
});

it('applies a change of estimate going forward only: a shorter life re-spreads what is left', function (): void {
    // 120,000.00 over 120 months, 12 months charged (12,000.00): carrying 108,000.00. Life cut to 60 months: 48 months left.
    $s = assetState(['dep' => 1200000, 'charged' => 12, 'life' => 60, 'through' => '2026-02-28', 'from' => '2025-03-01']);
    $c = DepreciationCalculator::charge($s, DepreciationCalculator::monthsDue($s, '2026-03-31'));

    expect($c->amount)->toBe(225000)->and($c->newMonthsCharged)->toBe(13);
    // (10,800,000 / 47 months left, since 13th month is this one: 60 - 12 = 48) -> 10,800,000 / 48 = 225,000.
});

it('uses the new carrying amount over the remaining life after an impairment, and advances the no-impairment path alongside', function (): void {
    // Carrying 100,000.00 impaired by 20,000.00 with 80 months left; counterfactual stays 100,000.00 until the next run.
    $s = assetState(['cost' => 12000000, 'dep' => 2000000, 'imp' => 2000000, 'charged' => 40, 'cf' => 10000000, 'through' => '2026-02-28', 'from' => '2023-01-01']);
    $c = DepreciationCalculator::charge($s, DepreciationCalculator::monthsDue($s, '2026-03-31'));

    // Actual: 8,000,000 / 80 = 100,000. Counterfactual: 10,000,000 / 80 = 125,000.
    expect($c->amount)->toBe(100000)->and($c->counterfactualAmount)->toBe(125000)->and($c->newCounterfactualCarrying)->toBe(9875000);
});
