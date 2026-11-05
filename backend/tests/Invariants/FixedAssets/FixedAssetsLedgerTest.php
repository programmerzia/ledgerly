<?php

declare(strict_types=1);

use Tests\Support\LedgerChecks;

/*
 * Fixed assets keep the books honest (13 §9, D15.1): the register is the sum of its movements, it ties to the ledger accounts, and
 * posting, reversing and re-running leave the ledger invariants (balanced journals, gapless numbers, projection = lines) intact.
 */

function assetInvariantProblems(): array
{
    adb('journals');

    return LedgerChecks::problems();
}

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
});

it('runs twelve months, reverses the newest, re-runs, and the register still ties to the ledger', function (): void {
    $this->capitalisedAsset($this->category['id'], ['name' => 'Press'], 12000000, '2026-01-10');
    $this->capitalisedAsset($this->category['id'], ['name' => 'Lathe', 'useful_life_months' => 7, 'residual' => 100000], 1000000, '2026-02-20');

    $runs = [];
    foreach (range(1, 12) as $month) {
        $runs[$month] = $this->postedRun(sprintf('2026-%02d-15', $month));
        expect(assetInvariantProblems())->toBe([]);
    }
    // The Lathe (7 months, 100,000 residual) is fully depreciated by August and drops out of later runs.
    expect(count($runs[12]['lines']))->toBe(1);

    $this->asPerson($this->owner, signing: true)->postJson($this->api("depreciation-runs/{$runs[12]['id']}/reverse"), [], $this->key())->assertOk();
    expect(assetInvariantProblems())->toBe([]);
    $this->postedRun('2026-12-15');

    $check = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/reconciliation?as_of=2026-12-31'))->assertOk()->json('data');
    expect(assetInvariantProblems())->toBe([])->and($check['reconciles'])->toBeTrue();

    $lathe = collect($this->asPerson($this->accountant)->getJson($this->api('fixed-assets?q=Lathe'))->json('data'))->first();
    // 1,000,000 - 100,000 residual: exactly, whatever the monthly rounding did.
    expect($lathe['accumulated_depreciation']['amount'])->toBe(900000)->and($lathe['carrying_amount']['amount'])->toBe(100000)->and($lathe['fully_depreciated'])->toBeTrue();
});

it('keeps accumulated depreciation within cost less residual whatever the method', function (): void {
    $db = $this->assetCategory(['name' => 'Fleet', 'default_method' => 'declining_balance', 'default_declining_rate_bp' => 3000, 'default_life_months' => null]);
    $this->capitalisedAsset($db['id'], ['name' => 'Van', 'method' => 'declining_balance', 'declining_rate_bp' => 3000, 'useful_life_months' => null, 'residual' => 500000], 3000000, '2026-01-05');
    foreach (range(1, 12) as $month) {
        $this->postedRun(sprintf('2026-%02d-15', $month));
    }

    $van = collect($this->asPerson($this->accountant)->getJson($this->api('fixed-assets'))->json('data'))->first();
    expect($van['carrying_amount']['amount'])->toBeGreaterThanOrEqual(500000)->and(assetInvariantProblems())->toBe([]);
});
