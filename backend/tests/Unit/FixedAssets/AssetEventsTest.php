<?php

declare(strict_types=1);

use App\Domain\FixedAssets\AssetEvents;
use App\Domain\FixedAssets\AssetOutcome;
use App\Domain\FixedAssets\AssetState;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Domain\Shared\DomainRuleViolation;

function eventState(array $o = []): AssetState
{
    return new AssetState(
        $o['cost'] ?? 12000000, $o['residual'] ?? 0, $o['dep'] ?? 2000000, $o['imp'] ?? 0, DepreciationMethod::StraightLine, 120, null, null, 0, 20, '2025-01-01', '2026-02-28',
        true, false, $o['cf'] ?? null, $o['reserve'] ?? 0, $o['deficit'] ?? 0, $o['revalued'] ?? false,
    );
}

/** @return list<array{string, int, int}> */
function lineSpecs(AssetOutcome $o): array
{
    return array_map(static fn ($l): array => [$l->role, $l->debit, $l->credit], $o->lines);
}

it('disposes with a gain: cost 120,000.00, accumulated 20,000.00, sold for 110,000.00 gives 10,000.00', function (): void {
    $o = AssetEvents::disposal(eventState(), 11000000, false);

    expect(lineSpecs($o))->toBe([['accumulated', 2000000, 0], ['proceeds', 11000000, 0], ['asset', 0, 12000000], ['gain', 0, 1000000]])
        ->and($o->cost)->toBe(-12000000)->and($o->depreciation)->toBe(-2000000)->and($o->facts['gain_or_loss'])->toBe(1000000);
});

it('disposes with a loss: sold for 80,000.00 against a carrying amount of 100,000.00 loses 20,000.00', function (): void {
    expect(lineSpecs(AssetEvents::disposal(eventState(), 8000000, false)))->toBe([['accumulated', 2000000, 0], ['proceeds', 8000000, 0], ['asset', 0, 12000000], ['loss', 2000000, 0]]);
});

it('disposes for nothing: the whole carrying amount is the loss', function (): void {
    expect(lineSpecs(AssetEvents::disposal(eventState(), 0, false)))->toBe([['accumulated', 2000000, 0], ['asset', 0, 12000000], ['loss', 10000000, 0]]);
});

it('moves the remaining revaluation reserve straight to retained earnings on disposal, never through profit or loss', function (): void {
    $o = AssetEvents::disposal(eventState(['reserve' => 700000, 'revalued' => true]), 10000000, true);

    expect(lineSpecs($o))->toBe([['accumulated', 2000000, 0], ['proceeds', 10000000, 0], ['asset', 0, 12000000], ['reserve', 700000, 0], ['retained', 0, 700000]])
        ->and($o->reserve)->toBe(-700000);
    // Without the transfer the reserve is left where it is.
    expect(lineSpecs(AssetEvents::disposal(eventState(['reserve' => 700000, 'revalued' => true]), 10000000, false)))->toHaveCount(3);
});

it('impairs a cost-model asset through profit or loss and remembers the path without it', function (): void {
    $o = AssetEvents::impairment(eventState(), 1500000);

    expect(lineSpecs($o))->toBe([['impairment_loss', 1500000, 0], ['accumulated', 0, 1500000]])->and($o->impairment)->toBe(1500000)
        ->and($o->set['counterfactual_carrying'])->toBe(10000000)->and($o->facts['carrying_after'])->toBe(8500000);
    expect(fn () => AssetEvents::impairment(eventState(['residual' => 9000000]), 1500000))->toThrow(DomainRuleViolation::class);
});

it('impairs a revalued asset against its own reserve first (IAS 36.60)', function (): void {
    $o = AssetEvents::impairment(eventState(['revalued' => true, 'reserve' => 400000]), 1000000);

    expect(lineSpecs($o))->toBe([['reserve', 400000, 0], ['impairment_loss', 600000, 0], ['accumulated', 0, 1000000]])
        ->and($o->reserve)->toBe(-400000)->and($o->deficit)->toBe(600000);
});

it('reverses an impairment only up to what depreciation alone would have left (IAS 36.117)', function (): void {
    // Impaired 1,500,000; depreciation since: 200,000 actual against 300,000 without the impairment. Carrying 8,300,000, path 9,000,000.
    $s = eventState(['dep' => 2200000, 'imp' => 1500000, 'cf' => 9000000]);

    expect(AssetEvents::reversalCap($s))->toBe(700000);
    $o = AssetEvents::impairmentReversal($s, 700000);
    expect(lineSpecs($o))->toBe([['accumulated', 700000, 0], ['impairment_reversal', 0, 700000]])->and($o->set['counterfactual_carrying'])->toBeNull();
    $part = AssetEvents::impairmentReversal($s, 300000);
    expect($part->set['counterfactual_carrying'])->toBe(9000000)->and($part->facts['carrying_after'])->toBe(8600000);
    expect(fn () => AssetEvents::impairmentReversal($s, 700001))->toThrow(DomainRuleViolation::class);
    expect(AssetEvents::reversalCap(eventState()))->toBe(0);
});

it('revalues up: reverses the earlier loss through profit or loss first, the excess goes to the reserve', function (): void {
    // Carrying 100,000.00 (cost 120,000.00 less 20,000.00), an earlier loss of 3,000.00; new value 110,000.00.
    $o = AssetEvents::revaluation(eventState(['deficit' => 300000]), 11000000);

    expect(lineSpecs($o))->toBe([['accumulated', 2000000, 0], ['asset', 0, 1000000], ['impairment_reversal', 0, 300000], ['reserve', 0, 700000]])
        ->and($o->cost)->toBe(-1000000)->and($o->depreciation)->toBe(-2000000)->and($o->reserve)->toBe(700000)->and($o->deficit)->toBe(-300000);
});

it('revalues down: uses the asset\'s reserve first, then profit or loss', function (): void {
    $o = AssetEvents::revaluation(eventState(['reserve' => 400000, 'revalued' => true]), 9000000);

    expect(lineSpecs($o))->toBe([['accumulated', 2000000, 0], ['asset', 0, 3000000], ['reserve', 400000, 0], ['impairment_loss', 600000, 0]])
        ->and($o->reserve)->toBe(-400000)->and($o->deficit)->toBe(600000);
});

it('revalues above cost: cost goes up, accumulated depreciation is eliminated, all of the increase goes to the reserve', function (): void {
    $o = AssetEvents::revaluation(eventState(['cost' => 10000000, 'dep' => 6000000]), 12000000);

    expect(lineSpecs($o))->toBe([['accumulated', 6000000, 0], ['asset', 2000000, 0], ['reserve', 0, 8000000]])->and($o->cost)->toBe(2000000);
});

it('leaves an unchanged asset out of a revaluation, and refuses a value below the residual', function (): void {
    expect(AssetEvents::revaluation(eventState(), 10000000))->toBeNull();
    expect(fn () => AssetEvents::revaluation(eventState(['residual' => 500000]), 400000))->toThrow(DomainRuleViolation::class);
});

it('balances every outcome', function (): void {
    $outcomes = [
        AssetEvents::disposal(eventState(), 7777777, false), AssetEvents::disposal(eventState(['reserve' => 5, 'revalued' => true]), 99, true),
        AssetEvents::impairment(eventState(), 1234567), AssetEvents::impairment(eventState(['revalued' => true, 'reserve' => 100]), 5000),
        AssetEvents::revaluation(eventState(['deficit' => 50]), 13000000), AssetEvents::revaluation(eventState(['reserve' => 70, 'revalued' => true]), 1234567),
    ];
    foreach ($outcomes as $o) {
        expect(array_sum(array_map(fn ($l) => $l->debit, $o->lines)))->toBe(array_sum(array_map(fn ($l) => $l->credit, $o->lines)));
    }
});
