<?php

declare(strict_types=1);

use App\Actions\Organisation\UpdateCompanySettings;
use App\Domain\Fx\MonetaryAccounts;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Domain\Reports\CashFlowClassifier;
use App\Domain\Reports\ProfitLossSection;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/** @return array{lines: list<array<string, mixed>>, posting_accounts: array<string, string>, is_recommended: bool} the stored comprehensive template */
function comprehensiveTemplate(): array
{
    app(TenantContext::class)->clear();
    $row = DB::table('chart_templates')->where('code', 'comprehensive')->first();
    if ($row === null) {
        throw new RuntimeException('The comprehensive template is not seeded.');
    }

    return [
        'lines' => json_decode((string) $row->lines, true, 512, JSON_THROW_ON_ERROR),
        'posting_accounts' => json_decode((string) $row->posting_accounts, true, 512, JSON_THROW_ON_ERROR),
        'is_recommended' => (bool) $row->is_recommended,
    ];
}

/** @return array<string, array<string, mixed>> lines keyed by code */
function comprehensiveByCode(): array
{
    return array_column(comprehensiveTemplate()['lines'], null, 'code');
}

it('is a recommended global template named Comprehensive (IFRS)', function () {
    $row = DB::table('chart_templates')->where('code', 'comprehensive')->first();

    expect($row)->not->toBeNull()
        ->and($row->name)->toBe('Comprehensive (IFRS)')
        ->and(comprehensiveTemplate()['is_recommended'])->toBeTrue()
        ->and(DB::table('chart_templates')->where('is_recommended', true)->count())->toBe(1);
});

it('has 250 to 350 postable accounts with unique 8-digit codes that follow the class scheme', function () {
    $lines = comprehensiveTemplate()['lines'];
    $parents = array_flip(array_filter(array_column($lines, 'parent_code')));
    $postable = array_filter($lines, fn ($l) => ! isset($parents[$l['code']]));
    $codes = array_column($lines, 'code');
    $classOf = ['asset' => ['1', '8'], 'liability' => ['2', '8'], 'equity' => ['3', '8'], 'income' => ['4', '7', '8'], 'expense' => ['5', '6', '7', '8']];
    $problems = [];

    foreach ($lines as $l) {
        if (preg_match('/^[1-8]\d{7}$/', $l['code']) !== 1) {
            $problems[] = "{$l['code']}: not 8 digits starting 1 to 8";

            continue;
        }
        if (! in_array($l['code'][0], $classOf[$l['account_type']], true)) {
            $problems[] = "{$l['code']}: a {$l['account_type']} in class {$l['code'][0]}";
        }
    }

    expect(count($postable))->toBeGreaterThanOrEqual(250)->toBeLessThanOrEqual(350)
        ->and(array_unique($codes))->toHaveCount(count($codes))
        ->and($problems)->toBe([]);
});

it('links parents that exist, share the type, and are headers without control types', function () {
    $by = comprehensiveByCode();
    $problems = [];
    foreach ($by as $code => $l) {
        $code = (string) $code;
        $parent = $l['parent_code'];
        if ($parent === null) {
            if (! str_ends_with($code, '000000')) {
                $problems[] = "{$code}: a root that is not a group header";
            }

            continue;
        }
        if (! isset($by[$parent])) {
            $problems[] = "{$code}: parent {$parent} missing";

            continue;
        }
        if ($by[$parent]['account_type'] !== $l['account_type']) {
            $problems[] = "{$code}: parent type differs";
        }
        if ($by[$parent]['control_type'] !== 'none' || $by[$parent]['parent_code'] !== null) {
            $problems[] = "{$code}: parent {$parent} is not a plain root header";
        }
        if (str_ends_with($code, '000000')) {
            $problems[] = "{$code}: a header code under a parent";
        }
        if (substr($code, 0, 2) !== substr($parent, 0, 2)) {
            $problems[] = "{$code}: not in the group of its parent";
        }
    }

    expect($problems)->toBe([]);
});

it('resolves every posting key to a postable account of a sensible type and control', function () {
    $t = comprehensiveTemplate();
    $by = array_column($t['lines'], null, 'code');
    $headers = array_flip(array_filter(array_column($t['lines'], 'parent_code')));

    // key => [type, normal balance, control type or null for "any but not a control that blocks nothing"]
    $expect = [
        'ar_control' => ['asset', 'debit', 'ar'], 'ap_control' => ['liability', 'credit', 'ap'],
        'tax_output' => ['liability', 'credit', 'tax'], 'tax_input' => ['asset', 'debit', 'tax'],
        'wht_payable' => ['liability', 'credit', 'tax'], 'retained_earnings' => ['equity', 'credit', 'retained_earnings'],
        'fx_realised' => ['income', 'credit', null], 'fx_realised_loss' => ['expense', 'debit', null],
        'fx_unrealised' => ['income', 'credit', null], 'fx_unrealised_loss' => ['expense', 'debit', null],
        'rounding' => ['expense', 'debit', null], 'suspense' => ['liability', 'credit', 'suspense'],
        'bank_clearing' => ['asset', 'debit', 'cash'], 'bank_in_transit' => ['asset', 'debit', 'cash'],
        'bad_debt_expense' => ['expense', 'debit', null], 'bad_debt_recovery' => ['income', 'credit', null],
        'credit_loss_allowance' => ['asset', 'credit', null], 'asset_disposal_gain' => ['income', 'credit', null],
        'asset_disposal_loss' => ['expense', 'debit', null], 'impairment_loss' => ['expense', 'debit', null],
        'impairment_reversal' => ['income', 'credit', null], 'revaluation_reserve' => ['equity', 'credit', null],
        'translation_reserve' => ['equity', 'credit', null], 'goodwill' => ['asset', 'debit', null],
        'non_controlling_interests' => ['equity', 'credit', null], 'reverse_charge_output' => ['liability', 'credit', 'tax'],
        'reverse_charge_input' => ['asset', 'debit', 'tax'], 'withholding_vat_receivable' => ['asset', 'debit', 'tax'],
    ];
    $problems = [];

    expect(array_keys($t['posting_accounts']))->toEqualCanonicalizing(array_keys($expect));
    foreach ($t['posting_accounts'] as $key => $code) {
        $line = $by[$code] ?? null;
        if ($line === null) {
            $problems[] = "{$key}: {$code} is not in the template";

            continue;
        }
        [$type, $normal, $control] = $expect[$key];
        if (isset($headers[$code])) {
            $problems[] = "{$key}: {$code} is a header";
        }
        if ([$line['account_type'], $line['normal_balance']] !== [$type, $normal]) {
            $problems[] = "{$key}: {$code} is {$line['account_type']}/{$line['normal_balance']}";
        }
        if ($control !== null && $line['control_type'] !== $control) {
            $problems[] = "{$key}: {$code} has control {$line['control_type']}";
        }
        if ($control === null && ! in_array($line['control_type'], ['none'], true)) {
            $problems[] = "{$key}: {$code} has control {$line['control_type']}";
        }
    }

    expect($problems)->toBe([]);
});

it('keeps every existing posting key and adds the new ones', function () {
    $keys = array_keys(comprehensiveTemplate()['posting_accounts']);
    $existing = array_keys(UpdateCompanySettings::POSTING_KEYS);

    expect(array_diff($existing, $keys))->toBe([]);
});

it('gives contra accounts the opposite normal balance and keeps control accounts on their side', function () {
    $problems = [];
    foreach (comprehensiveTemplate()['lines'] as $l) {
        $usual = in_array($l['account_type'], ['asset', 'expense'], true) ? 'debit' : 'credit';
        $control = $l['control_type'];
        if ($control === 'accum_depr' && ($l['account_type'] !== 'asset' || $l['normal_balance'] !== 'credit' || $l['account_subtype'] !== 'Contra Asset')) {
            $problems[] = "{$l['code']}: accumulated account must be a credit-normal contra asset";
        }
        if ($control === 'fixed_asset' && ($l['account_type'] !== 'asset' || $l['normal_balance'] !== 'debit')) {
            $problems[] = "{$l['code']}: fixed asset must be a debit asset";
        }
        if ($l['account_subtype'] === 'Contra Asset' && $l['normal_balance'] !== 'credit') {
            $problems[] = "{$l['code']}: contra asset must be credit-normal";
        }
        if ($l['normal_balance'] !== $usual && $l['account_subtype'] !== 'Contra Asset' && ! preg_match('/carries a (debit|credit) balance/i', (string) $l['description'])) {
            $problems[] = "{$l['code']}: unusual normal balance without a description saying so";
        }
        if (! in_array($l['currency_policy'], ['base_only', 'any'], true) || ControlType::tryFrom($l['control_type']) === null) {
            $problems[] = "{$l['code']}: bad policy or control";
        }
    }

    expect($problems)->toBe([]);
});

it('has every depreciable class with its own accumulated depreciation and expense, and impairment and goodwill', function () {
    $by = comprehensiveByCode();
    $names = array_column($by, 'name');
    $has = fn (string $needle) => count(array_filter($names, fn ($n) => str_contains($n, $needle))) > 0;
    $classes = ['buildings', 'plant and machinery', 'motor vehicles', 'computers and IT equipment', 'furniture and fittings', 'leasehold improvements', 'right-of-use buildings', 'right-of-use vehicles', 'right-of-use equipment'];
    $missing = [];

    foreach ($classes as $class) {
        foreach (['Accumulated depreciation: '.$class, 'Depreciation: '.$class] as $name) {
            if (! in_array($name, $names, true)) {
                $missing[] = $name;
            }
        }
    }
    foreach (['Land', 'Assets under construction', 'Goodwill', 'Impairment loss: goodwill', 'Impairment loss: property, plant and equipment', 'Reversal of impairment loss', 'Treasury shares', 'Revaluation reserve', 'Foreign currency translation reserve', 'Intercompany receivable', 'Intercompany payable', 'Goods received not invoiced', 'Deferred tax asset', 'Deferred tax liability', 'Rounding differences', 'Suspense account', 'Reverse-charge input VAT', 'Reverse-charge output VAT', 'Import VAT recoverable', 'VAT clearing', 'Withholding VAT receivable', 'Withholding tax receivable', 'Withholding tax payable', 'Funds in transit between accounts', 'Payments in transit', 'Goods in transit', 'Bad debts recovered', 'Allowance for credit losses'] as $name) {
        if (! in_array($name, $names, true)) {
            $missing[] = $name;
        }
    }

    expect($missing)->toBe([])->and($has('Lease liabilities'))->toBeTrue();
});

it('sends every balance sheet account to a cash flow activity without falling back to the default', function () {
    $assumed = [];
    foreach (comprehensiveTemplate()['lines'] as $l) {
        if ($l['parent_code'] === null || ! in_array($l['account_type'], ['asset', 'liability'], true) || in_array($l['control_type'], ['cash', 'bank'], true)) {
            continue;
        }
        if (CashFlowClassifier::classify($l['account_type'], $l['account_subtype'], $l['control_type'])->assumed) {
            $assumed[] = "{$l['code']} ({$l['account_subtype']})";
        }
    }

    expect($assumed)->toBe([]);
});

it('puts every income and expense account in a profit and loss section by its subtype', function () {
    $problems = [];
    foreach (comprehensiveTemplate()['lines'] as $l) {
        if (! in_array($l['account_type'], ['income', 'expense'], true)) {
            continue;
        }
        $section = ProfitLossSection::of($l['account_type'], $l['account_subtype']);
        $allowed = $l['account_type'] === 'income' ? ['Operating Revenue', 'Other Income'] : ['Direct Costs', 'Operating Expense', 'Other Expense'];
        if ($section === null || ! in_array($l['account_subtype'], $allowed, true)) {
            $problems[] = "{$l['code']}: subtype {$l['account_subtype']}";
        }
    }

    expect($problems)->toBe([]);
});

it('keeps the non-monetary balance sheet items out of exchange revaluation and monetary ones in', function () {
    $by = comprehensiveByCode();
    $revalued = fn (string $code) => MonetaryAccounts::isRevalued(
        $by[$code]['account_type'], ControlType::from($by[$code]['control_type']),
        CurrencyPolicy::from($by[$code]['currency_policy']), $by[$code]['account_subtype'],
    );

    expect($revalued('12010000'))->toBeTrue()      // trade receivables
        ->and($revalued('21010000'))->toBeTrue()   // trade payables
        ->and($revalued('11050000'))->toBeTrue()   // bank
        ->and($revalued('27040000'))->toBeTrue()   // long-term loan
        ->and($revalued('15010000'))->toBeFalse()  // inventory
        ->and($revalued('14010000'))->toBeFalse()  // prepayment
        ->and($revalued('16020000'))->toBeFalse()  // buildings
        ->and($revalued('22020000'))->toBeFalse(); // deferred revenue
});

it('stores only element names that exist in the IFRS taxonomy format, and a sensible share of them', function () {
    $lines = comprehensiveTemplate()['lines'];
    $postable = array_filter($lines, fn ($l) => $l['parent_code'] !== null);
    $withElement = array_filter($postable, fn ($l) => isset($l['ifrs_element']));
    $bad = array_filter($withElement, fn ($l) => preg_match('/^[A-Z][A-Za-z0-9]+$/', (string) $l['ifrs_element']) !== 1);

    expect($bad)->toBe([])->and(count($withElement))->toBeGreaterThan(80);
});

it('starts specialist accounts hidden, and not the everyday ones or the key posting accounts', function () {
    $by = comprehensiveByCode();
    $hidden = fn (string $code) => ($by[$code]['is_hidden'] ?? false) === true;

    expect($hidden('11050000'))->toBeFalse()->and($hidden('12010000'))->toBeFalse()->and($hidden('21010000'))->toBeFalse()
        ->and($hidden('41010000'))->toBeFalse()->and($hidden('23010000'))->toBeFalse()->and($hidden('32010000'))->toBeFalse()
        ->and($hidden('17010000'))->toBeTrue()->and($hidden('34010000'))->toBeTrue()->and($hidden('33010000'))->toBeTrue()
        ->and($hidden('82010000'))->toBeTrue();
    // group headers are never hidden: they have no flag
    expect(isset($by['11000000']['is_hidden']))->toBeFalse();
});

it('leaves the four older templates exactly as they were', function (string $code) {
    $row = DB::table('chart_templates')->where('code', $code)->first();
    $lines = json_decode((string) $row->lines, true, 512, JSON_THROW_ON_ERROR);
    $posting = json_decode((string) $row->posting_accounts, true, 512, JSON_THROW_ON_ERROR);
    $newKeys = ['bank_in_transit', 'bad_debt_expense', 'bad_debt_recovery', 'credit_loss_allowance', 'asset_disposal_gain', 'asset_disposal_loss', 'impairment_loss', 'impairment_reversal', 'revaluation_reserve', 'translation_reserve', 'goodwill', 'non_controlling_interests', 'reverse_charge_output', 'reverse_charge_input', 'withholding_vat_receivable'];

    expect((bool) $row->is_recommended)->toBeFalse()
        ->and(array_filter($lines, fn ($l) => array_key_exists('ifrs_element', $l) || array_key_exists('is_hidden', $l)))->toBe([])
        ->and(array_intersect($newKeys, array_keys($posting)))->toBe([])
        ->and(count($lines))->toBeLessThanOrEqual(70);
})->with(['ifrs_sme', 'us_small_business', 'non_profit', 'insurance']);
