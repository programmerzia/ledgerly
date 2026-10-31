<?php

declare(strict_types=1);

use App\Domain\Ledger\ControlType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** @return list<array<string, mixed>> the lines of a seeded chart template, as stored */
function chartTplStoredLines(string $code): array
{
    $json = DB::table('chart_templates')->where('code', $code)->value('lines');
    if (! is_string($json)) {
        throw new RuntimeException("Chart template {$code} is not seeded.");
    }

    return json_decode($json, true, 512, JSON_THROW_ON_ERROR);
}

$starterCharts = ['ifrs_sme', 'us_small_business', 'non_profit', 'insurance'];

it('seeds the four starter templates as global reference data', function () {
    app(TenantContext::class)->clear();

    $rows = DB::table('chart_templates')->orderBy('code')->get();

    expect(Schema::hasColumn('chart_templates', 'tenant_id'))->toBeFalse()
        ->and($rows->pluck('code')->all())->toBe(['ifrs_sme', 'insurance', 'non_profit', 'us_small_business'])
        ->and($rows->pluck('country', 'code')->all())->toBe(['ifrs_sme' => null, 'insurance' => null, 'non_profit' => null, 'us_small_business' => 'US'])
        ->and($rows->every(fn ($row) => $row->name !== '' && $row->standard !== ''))->toBeTrue()
        ->and(DB::table('chart_templates')->whereRaw("jsonb_typeof(lines) <> 'array'")->count())->toBe(0);
});

it('keeps each template between 40 and 70 accounts with unique codes', function (string $code) {
    $lines = chartTplStoredLines($code);
    $codes = array_column($lines, 'code');

    expect(count($lines))->toBeGreaterThanOrEqual(40)->toBeLessThanOrEqual(70)
        ->and(array_unique($codes))->toHaveCount(count($codes));
})->with($starterCharts);

it('has the control accounts the ledger looks up', function (string $code) {
    $tally = array_count_values(array_column(chartTplStoredLines($code), 'control_type'));
    $problems = [];

    foreach (['ar', 'ap', 'retained_earnings', 'suspense'] as $control) {
        if (($tally[$control] ?? 0) !== 1) {
            $problems[] = "{$control}: ".($tally[$control] ?? 0).' accounts, expected exactly 1';
        }
    }
    foreach (['cash', 'bank', 'tax', 'fixed_asset', 'accum_depr'] as $control) {
        if (($tally[$control] ?? 0) < 1) {
            $problems[] = "{$control}: no account";
        }
    }

    expect($problems)->toBe([]);
})->with($starterCharts);

it('puts control accounts on the side and in the class posting expects', function (string $code) {
    $expected = [
        'ar' => ['asset', 'debit'], 'ap' => ['liability', 'credit'], 'retained_earnings' => ['equity', 'credit'],
        'cash' => ['asset', 'debit'], 'bank' => ['asset', 'debit'],
        'fixed_asset' => ['asset', 'debit'], 'accum_depr' => ['asset', 'credit'],
    ];
    $problems = [];

    foreach (chartTplStoredLines($code) as $line) {
        $want = $expected[$line['control_type']] ?? null;
        if ($want !== null && [$line['account_type'], $line['normal_balance']] !== $want) {
            $problems[] = "{$line['code']} ({$line['control_type']}) is {$line['account_type']}/{$line['normal_balance']}";
        }
        if ($line['control_type'] === 'tax' && ! in_array($line['account_type'], ['asset', 'liability'], true)) {
            $problems[] = "{$line['code']} (tax) is {$line['account_type']}";
        }
    }

    expect($problems)->toBe([]);
})->with($starterCharts);

it('links every parent code to a line of the same type, without cycles', function (string $code) {
    $lines = chartTplStoredLines($code);
    $byCode = array_column($lines, null, 'code');
    $problems = [];

    foreach ($lines as $line) {
        $parent = $line['parent_code'];
        if ($parent === null) {
            continue;
        }
        if (! isset($byCode[$parent])) {
            $problems[] = "{$line['code']}: parent {$parent} is not in the template";
        } elseif ($byCode[$parent]['account_type'] !== $line['account_type']) {
            $problems[] = "{$line['code']}: parent {$parent} is a {$byCode[$parent]['account_type']}";
        }

        $cursor = $line['code'];
        for ($steps = 0; $cursor !== null && $steps <= count($lines); $steps++) {
            $cursor = $byCode[$cursor]['parent_code'] ?? null;
        }
        if ($cursor !== null) {
            $problems[] = "{$line['code']}: parents loop";
        }
    }

    expect($problems)->toBe([]);
})->with($starterCharts);

it('keeps group headers and control accounts apart', function (string $code) {
    $lines = chartTplStoredLines($code);
    $headers = array_flip(array_filter(array_column($lines, 'parent_code')));
    $problems = [];

    foreach ($lines as $line) {
        if (isset($headers[$line['code']]) && $line['control_type'] !== 'none') {
            $problems[] = "{$line['code']} is a group header but also a {$line['control_type']} control account";
        }
    }

    expect($headers)->not->toBeEmpty()->and($problems)->toBe([]);
})->with($starterCharts);

it('only uses values the accounts table and the reports accept', function (string $code) {
    $keys = ['account_subtype', 'account_type', 'code', 'control_type', 'currency_policy', 'description', 'name', 'normal_balance', 'parent_code'];
    $reportSubtypes = [
        'income' => ['Operating Revenue', 'Other Income'],
        'expense' => ['Direct Costs', 'Operating Expense', 'Other Expense'],
    ];
    $problems = [];

    foreach (chartTplStoredLines($code) as $line) {
        $at = $line['code'] ?? '?';
        $present = array_keys($line);
        sort($present);
        if ($present !== $keys) {
            $problems[] = "{$at}: keys differ from the line format";
        }
        if (! is_string($line['code']) || $line['code'] === '' || strlen($line['code']) > 32) {
            $problems[] = "{$at}: bad code";
        }
        if (! is_string($line['name']) || $line['name'] === '' || strlen($line['name']) > 255) {
            $problems[] = "{$at}: bad name";
        }
        if (! in_array($line['account_type'], ['asset', 'liability', 'equity', 'income', 'expense'], true)) {
            $problems[] = "{$at}: account_type {$line['account_type']}";
        }
        if (! is_string($line['account_subtype']) || $line['account_subtype'] === '' || strlen($line['account_subtype']) > 64) {
            $problems[] = "{$at}: account_subtype must be a short non-empty string";
        }
        if (! in_array($line['normal_balance'], ['debit', 'credit'], true)) {
            $problems[] = "{$at}: normal_balance {$line['normal_balance']}";
        }
        if (ControlType::tryFrom($line['control_type']) === null) {
            $problems[] = "{$at}: control_type {$line['control_type']}";
        }
        // A template cannot know a currency, so `fixed` (which needs one) is not available.
        if (! in_array($line['currency_policy'], ['base_only', 'any'], true)) {
            $problems[] = "{$at}: currency_policy {$line['currency_policy']}";
        }
        if ($line['description'] !== null && (! is_string($line['description']) || $line['description'] === '')) {
            $problems[] = "{$at}: description must be null or text";
        }
        if (isset($reportSubtypes[$line['account_type']]) && ! in_array($line['account_subtype'], $reportSubtypes[$line['account_type']], true)) {
            $problems[] = "{$at}: {$line['account_type']} subtype '{$line['account_subtype']}' matches no report section";
        }
    }

    expect($problems)->toBe([]);
})->with($starterCharts);
