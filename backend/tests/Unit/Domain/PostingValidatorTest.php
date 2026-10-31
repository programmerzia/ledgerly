<?php

declare(strict_types=1);

use App\Domain\Fiscal\PeriodKind;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\AccountInfo;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Domain\Ledger\DimensionRule;
use App\Domain\Ledger\DimensionValueInfo;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PeriodInfo;
use App\Domain\Ledger\PostingContext;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;

function ctx(array $overrides = []): PostingContext
{
    $accounts = [
        'cash' => new AccountInfo('cash', '1000', true, true, ControlType::Cash, CurrencyPolicy::BaseOnly),
        'ar' => new AccountInfo('ar', '1100', true, true, ControlType::Ar, CurrencyPolicy::Any),
        'eurbank' => new AccountInfo('eurbank', '1200', true, true, ControlType::None, CurrencyPolicy::Fixed, 'EUR'),
        'prepaid' => new AccountInfo('prepaid', '1300', true, true, ControlType::None, CurrencyPolicy::Any),
        'sales' => new AccountInfo('sales', '4000', true, true, ControlType::None, CurrencyPolicy::BaseOnly),
        'header' => new AccountInfo('header', '4', false, true, ControlType::None, CurrencyPolicy::BaseOnly),
        'old' => new AccountInfo('old', '4999', true, false, ControlType::None, CurrencyPolicy::BaseOnly),
        'dept' => new AccountInfo('dept', '5000', true, true, ControlType::None, CurrencyPolicy::BaseOnly, null, false,
            [1 => DimensionRule::Required, 2 => DimensionRule::Forbidden]),
    ];

    return new PostingContext(
        baseCurrency: 'USD',
        accounts: $overrides['accounts'] ?? $accounts,
        dimensionValues: [
            'd1-sales' => new DimensionValueInfo('d1-sales', 1, true),
            'd1-closed' => new DimensionValueInfo('d1-closed', 1, false),
            'd2-x' => new DimensionValueInfo('d2-x', 2, true),
        ],
        period: array_key_exists('period', $overrides) ? $overrides['period'] : period(),
        canPostSoftClosed: $overrides['soft'] ?? false,
        canPostAdjustment: $overrides['adjust'] ?? false,
    );
}

function period(PeriodStatus $status = PeriodStatus::Open, PeriodKind $kind = PeriodKind::Regular): PeriodInfo
{
    return $kind === PeriodKind::Regular
        ? new PeriodInfo('p3', $status, $kind, new DateTimeImmutable('2026-03-01'), new DateTimeImmutable('2026-03-31'))
        : new PeriodInfo('p13', $status, $kind, new DateTimeImmutable('2026-12-31'), new DateTimeImmutable('2026-12-31'));
}

/** @param list<DraftLine> $lines */
function draft(array $lines, JournalType $type = JournalType::Manual, string $date = '2026-03-15', ?string $reversalOf = null): JournalDraft
{
    return new JournalDraft('co', $type, new DateTimeImmutable($date), $lines, reversalOfDate: $reversalOf ? new DateTimeImmutable($reversalOf) : null);
}

/** @return list<string> */
function codes(callable $fn): array
{
    try {
        $fn();
    } catch (PostingRejected $e) {
        return array_map(fn ($v) => $v->code, $e->violations);
    }

    return [];
}

$validator = new PostingValidator;

it('accepts a balanced journal and aggregates balance deltas', function () use ($validator) {
    $plan = $validator->validate(draft([
        new DraftLine('cash', debit: 1000),
        new DraftLine('cash', debit: 500),
        new DraftLine('sales', credit: 1500),
    ]), ctx());

    expect($plan->totalDebit)->toBe(1500)->and($plan->totalCredit)->toBe(1500)
        ->and($plan->balanceDeltas)->toHaveCount(2)
        ->and(collect($plan->balanceDeltas)->firstWhere('accountId', 'cash')->debit)->toBe(1500);
});

it('rejects unbalanced, empty, two-sided and zero lines, collecting every violation', function () use ($validator) {
    expect(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: 100), new DraftLine('sales', credit: 99)]), ctx())))
        ->toBe(['journal_unbalanced'])
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: 100)]), ctx())))
        ->toContain('journal_empty')
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: 5, credit: 5), new DraftLine('sales', debit: 0, credit: 0)]), ctx())))
        ->toBe(['line_both_sides', 'amount_out_of_range'])
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: -5), new DraftLine('sales', credit: -5)]), ctx())))
        ->toBe(['amount_out_of_range', 'amount_out_of_range']);
});

it('reports line numbers on line violations', function () use ($validator) {
    try {
        $validator->validate(draft([new DraftLine('cash', debit: 10), new DraftLine('header', credit: 10)]), ctx());
        $this->fail('expected rejection');
    } catch (PostingRejected $e) {
        expect($e->violations[0]->code)->toBe('account_not_postable')->and($e->violations[0]->lineNo)->toBe(2);
    }
});

it('checks accounts: other company, inactive, control accounts, contact required', function () use ($validator) {
    expect(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: 10), new DraftLine('nope', credit: 10)]), ctx())))
        ->toBe(['account_other_company'])
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('cash', debit: 10), new DraftLine('old', credit: 10)]), ctx())))
        ->toBe(['account_inactive'])
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('ar', debit: 10), new DraftLine('sales', credit: 10)]), ctx())))
        ->toBe(['control_account_direct', 'contact_required'])
        ->and(codes(fn () => $validator->validate(draft([new DraftLine('ar', debit: 10, contactId: 'c1'), new DraftLine('sales', credit: 10)], JournalType::Sales), ctx())))
        ->toBe([]);
});

it('enforces dimension rules', function () use ($validator) {
    $run = fn (array $dims) => codes(fn () => $validator->validate(draft([new DraftLine('dept', debit: 10, dims: $dims), new DraftLine('sales', credit: 10)]), ctx()));

    expect($run([]))->toBe(['dimension_required'])
        ->and($run([1 => 'd1-sales', 2 => 'd2-x']))->toBe(['dimension_forbidden'])
        ->and($run([1 => 'd1-closed']))->toBe(['dimension_inactive'])
        ->and($run([1 => 'd2-x']))->toBe(['dimension_value_invalid'])
        ->and($run([1 => 'd1-sales']))->toBe([]);
});

it('enforces currency policy and fx data', function () use ($validator) {
    expect(codes(fn () => $validator->validate(draft([
        new DraftLine('cash', debit: 110, currency: 'EUR', fxRate: '1.1', amountFc: 100),
        new DraftLine('sales', credit: 110),
    ]), ctx())))->toBe(['currency_not_allowed'])
        ->and(codes(fn () => $validator->validate(draft([
            new DraftLine('eurbank', debit: 110, currency: 'EUR'),
            new DraftLine('sales', credit: 110),
        ]), ctx())))->toBe(['fx_rate_missing'])
        ->and(codes(fn () => $validator->validate(draft([
            new DraftLine('eurbank', debit: 110, currency: 'EUR', fxRate: '1.1', amountFc: -100),
            new DraftLine('sales', credit: 110),
        ]), ctx())))->toBe(['amount_out_of_range']);
});

it('requires single-foreign-currency journals to balance in that currency too (D6)', function () use ($validator) {
    $unbalancedFc = draft([
        new DraftLine('eurbank', debit: 110, currency: 'EUR', fxRate: '1.1', amountFc: 100),
        new DraftLine('prepaid', credit: 110, currency: 'EUR', fxRate: '1.1', amountFc: -101),
    ]);
    $mixed = draft([
        new DraftLine('eurbank', debit: 110, currency: 'EUR', fxRate: '1.1', amountFc: 100),
        new DraftLine('cash', credit: 110),
    ]);

    expect(codes(fn () => $validator->validate($unbalancedFc, ctx())))->toBe(['journal_unbalanced_fc'])
        ->and(codes(fn () => $validator->validate($mixed, ctx())))->toBe([]);
});

it('applies period status rules (D5)', function () use ($validator) {
    $lines = [new DraftLine('cash', debit: 10), new DraftLine('sales', credit: 10)];

    expect(codes(fn () => $validator->validate(draft($lines), ctx(['period' => null]))))->toBe(['period_missing'])
        ->and(codes(fn () => $validator->validate(draft($lines), ctx(['period' => period(PeriodStatus::Closed)]))))->toBe(['period_closed'])
        ->and(codes(fn () => $validator->validate(draft($lines), ctx(['period' => period(PeriodStatus::Locked)]))))->toBe(['period_closed'])
        ->and(codes(fn () => $validator->validate(draft($lines), ctx(['period' => period(PeriodStatus::SoftClosed)]))))->toBe(['period_soft_closed'])
        ->and(codes(fn () => $validator->validate(draft($lines), ctx(['period' => period(PeriodStatus::SoftClosed), 'soft' => true]))))->toBe([])
        ->and(codes(fn () => $validator->validate(draft($lines, date: '2026-04-01'), ctx())))->toBe(['date_outside_period']);
});

it('keeps the adjustment period for closing and adjustment journals (D7)', function () use ($validator) {
    $lines = [new DraftLine('cash', debit: 10), new DraftLine('sales', credit: 10)];
    $adj = period(PeriodStatus::Open, PeriodKind::Adjustment);

    expect(codes(fn () => $validator->validate(draft($lines, date: '2026-12-31'), ctx(['period' => $adj, 'adjust' => true]))))->toBe(['period_adjustment_only'])
        ->and(codes(fn () => $validator->validate(draft($lines, JournalType::Closing), ctx())))->toBe(['period_adjustment_only'])
        ->and(codes(fn () => $validator->validate(draft($lines, JournalType::Closing, '2026-12-31'), ctx(['period' => $adj]))))->toBe(['period_adjustment_forbidden'])
        ->and(codes(fn () => $validator->validate(draft($lines, JournalType::Adjustment, '2026-12-31'), ctx(['period' => $adj, 'adjust' => true]))))->toBe([]);
});

it('rejects reversals dated before the original (D3)', function () use ($validator) {
    $lines = [new DraftLine('cash', credit: 10), new DraftLine('sales', debit: 10)];

    expect(codes(fn () => $validator->validate(draft($lines, JournalType::Reversal, '2026-03-10', reversalOf: '2026-03-11'), ctx())))->toBe(['reversal_before_original'])
        ->and(codes(fn () => $validator->validate(draft($lines, JournalType::Reversal, '2026-03-11', reversalOf: '2026-03-11'), ctx())))->toBe([]);
});
