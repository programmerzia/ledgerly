<?php

declare(strict_types=1);

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\DecidePeriodReopen;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\LockFiscalYear;
use App\Actions\Fiscal\RequestPeriodReopen;
use App\Actions\Fiscal\SoftClosePeriod;
use App\Actions\Fiscal\YearEndClose;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * Period lifecycle (PRD §4, 13 §10, D5, D7): soft close, close with checks and waivers, reopen by
 * two signed approvers, year-end close to retained earnings (re-runnable), and the final lock.
 */

beforeEach(function (): void {
    $this->grant('periods.close', 'periods.reopen.request', 'periods.reopen.approve', 'periods.year_end', 'periods.post_adjustment', 'journals.reverse');
    $this->f = LedgerFixture::create();
});

function signer(LedgerFixture $f, ?string $id = null, bool $grant = true): Actor
{
    return new Actor(ActorType::User, $id ?? $f->userId, $f->tenantId, $f->companyId, hasSigningGrant: $grant);
}

function anotherUser(LedgerFixture $f, string $name): string
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => strtolower($name).'@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);

    return $id;
}

function closeMonth(LedgerFixture $f, string $date, array $waivers = []): FiscalPeriod
{
    return app(ClosePeriod::class)->handle(signer($f), new ClosePeriodInput($f->period($date)->id, $waivers));
}

function closeAllMonths(LedgerFixture $f): void
{
    foreach (range(1, 12) as $m) {
        closeMonth($f, sprintf('2026-%02d-15', $m));
    }
}

function expense(LedgerFixture $f, int $amount, string $date = '2026-03-20'): Journal
{
    return postJournal($f, draftJournal($f, [new DraftLine($f->account('5000'), debit: $amount), new DraftLine($f->account('1000'), credit: $amount)], $date));
}

it('soft-closes: only holders of periods.post_soft_closed can still post there', function (): void {
    $period = app(SoftClosePeriod::class)->handle($this->f->actor, $this->f->period('2026-03-15')->id);
    expect($period->status)->toBe(PeriodStatus::SoftClosed)->and($period->soft_closed_at)->not->toBeNull();

    expect(fn () => cashSale($this->f))->toThrow(PostingRejected::class);
    $this->grant('periods.close', 'periods.post_soft_closed');
    expect(cashSale($this->f)->status)->toBe(JournalStatus::Posted);
});

it('closes only with a signing grant and passing or waived checks, storing each outcome', function (): void {
    $draft = draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 500), new DraftLine($this->f->account('4000'), credit: 500)]);
    $march = $this->f->period('2026-03-15')->id;

    expect(fn () => app(ClosePeriod::class)->handle(signer($this->f, grant: false), new ClosePeriodInput($march)))
        ->toThrow(DomainRuleViolation::class, 'signing PIN');

    try {
        closeMonth($this->f, '2026-03-15');
        $this->fail('A stranded draft must block the close.');
    } catch (DomainRuleViolation $e) {
        expect($e->errorCode)->toBe('period_checks_failed')->and($e->violations[0]->message)->toStartWith('DRAFTS');
    }
    expect($this->f->period('2026-03-15')->status)->toBe(PeriodStatus::Open);

    $closed = closeMonth($this->f, '2026-03-15', ['DRAFTS' => 'Duplicate of JNL-12, will be voided']);
    expect($closed->status)->toBe(PeriodStatus::Closed)->and($closed->closed_by)->toBe($this->f->userId)
        ->and(DB::table('period_close_checks')->where('fiscal_period_id', $march)->orderBy('check_code')->pluck('status', 'check_code')->all())
        ->toBe(['APPROVALS' => 'pass', 'BANK_REC' => 'pass', 'DEPR_RUN' => 'pass', 'DRAFTS' => 'waived', 'FX_REVAL' => 'pass'])
        ->and(DB::table('period_close_checks')->where('check_code', 'DRAFTS')->value('waived_reason'))->toBe('Duplicate of JNL-12, will be voided');

    expect(fn () => postJournal($this->f, $draft))->toThrow(PostingRejected::class);
    expect(fn () => closeMonth($this->f, '2026-03-15'))->toThrow(DomainRuleViolation::class, 'already closed');
});

it('reopens a closed period only after two different signed approvers, neither the requester', function (): void {
    closeMonth($this->f, '2026-03-15');
    $march = $this->f->period('2026-03-15')->id;
    $amina = anotherUser($this->f, 'Amina');
    $kenneth = anotherUser($this->f, 'Kenneth');

    expect(fn () => app(RequestPeriodReopen::class)->handle($this->f->actor, $this->f->period('2026-04-15')->id, 'x'))
        ->toThrow(DomainRuleViolation::class, 'Only a closed period');
    $request = app(RequestPeriodReopen::class)->handle($this->f->actor, $march, 'Missed supplier invoice for March');
    expect(fn () => app(RequestPeriodReopen::class)->handle($this->f->actor, $march, 'again'))->toThrow(DomainRuleViolation::class, 'already waiting');

    $decide = app(DecidePeriodReopen::class);
    expect(fn () => $decide->approve(signer($this->f), $request->id))->toThrow(DomainRuleViolation::class, 'two other people');
    expect(fn () => $decide->approve(signer($this->f, $amina, grant: false), $request->id))->toThrow(DomainRuleViolation::class, 'signing PIN');

    $decide->approve(signer($this->f, $amina), $request->id);
    expect($this->f->period('2026-03-15')->status)->toBe(PeriodStatus::Closed);
    expect(fn () => $decide->approve(signer($this->f, $amina), $request->id))->toThrow(DomainRuleViolation::class, 'second, different approver');

    $done = $decide->approve(signer($this->f, $kenneth), $request->id);
    $period = $this->f->period('2026-03-15');
    expect($done->status->value)->toBe('approved')
        ->and([$done->first_approver, $done->second_approver])->toBe([$amina, $kenneth])
        ->and($period->status)->toBe(PeriodStatus::Open)
        ->and($period->reopened_count)->toBe(1)
        ->and(cashSale($this->f)->status)->toBe(JournalStatus::Posted)
        ->and(DB::table('audit_events')->where('action', 'period.reopen_approved')->count())->toBe(2);
});

it('lets an approver reject a reopen with a comment', function (): void {
    closeMonth($this->f, '2026-03-15');
    $request = app(RequestPeriodReopen::class)->handle($this->f->actor, $this->f->period('2026-03-15')->id, 'Typo');
    $amina = anotherUser($this->f, 'Amina');

    expect(fn () => app(DecidePeriodReopen::class)->reject(signer($this->f, $amina), $request->id, ''))->toThrow(DomainRuleViolation::class, 'why');
    $rejected = app(DecidePeriodReopen::class)->reject(signer($this->f, $amina, grant: false), $request->id, 'Post it as an adjustment instead');
    expect($rejected->status->value)->toBe('rejected')->and($this->f->period('2026-03-15')->status)->toBe(PeriodStatus::Closed);
});

it('closes the year into retained earnings, per account, and re-runs by reversing the previous closing journal', function (): void {
    cashSale($this->f, 10000, '2026-02-10');
    expense($this->f, 4000, '2026-05-10');

    expect(fn () => app(YearEndClose::class)->handle(signer($this->f), $this->f->period('2026-01-15')->fiscal_year_id))
        ->toThrow(DomainRuleViolation::class, 'Close every month');

    closeAllMonths($this->f);
    $yearId = $this->f->period('2026-01-15')->fiscal_year_id;
    $closing = app(YearEndClose::class)->handle(signer($this->f), $yearId);

    $lines = $closing?->lines()->get()->mapWithKeys(fn ($l) => [array_flip($this->f->accounts)[$l->account_id] => [$l->debit, $l->credit]])->all();
    expect($closing?->journal_type)->toBe(JournalType::Closing)
        ->and($closing?->fiscal_period_id)->toBe($this->f->adjustmentPeriod()->id)
        ->and($lines)->toBe(['4000' => [10000, 0], '5000' => [0, 4000], '3000' => [0, 6000]])
        ->and(DB::table('fiscal_years')->where('id', $yearId)->value('status'))->toBe('closed');

    // An audit adjustment after the close goes to the adjustment period; the re-run picks it up.
    $this->clock->advance('+1 day');
    postJournal($this->f, draftJournal($this->f, [
        new DraftLine($this->f->account('5000'), debit: 1000), new DraftLine($this->f->account('1300'), credit: 1000),
    ], '2026-12-31', JournalType::Adjustment, $this->f->adjustmentPeriod()->id));
    $rerun = app(YearEndClose::class)->handle(signer($this->f), $yearId);

    $live = Journal::query()->where('journal_type', 'closing')->where('status', 'posted')->whereNull('reversal_of_id')->pluck('id')->all();
    expect($live)->toBe([$rerun?->id])
        ->and($closing?->fresh()?->status)->toBe(JournalStatus::Reversed)
        ->and($rerun?->lines()->where('account_id', $this->f->account('3000'))->value('credit'))->toBe(5000);

    // Income and expenses net to zero over the year, closing included; retained earnings holds the result.
    $net = fn (string $code) => (int) DB::table('account_period_balances')->where('account_id', $this->f->account($code))->sum(DB::raw('credit - debit'));
    expect([$net('4000'), $net('5000'), $net('3000')])->toBe([0, 0, 5000]);
});

it('keeps each fund separate through the year-end close, per dimension', function (): void {
    $dimension = (string) Str::uuid7();
    $fund = (string) Str::uuid7();
    DB::table('dimensions')->insert(['id' => $dimension, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => 'FUND', 'name' => 'Fund', 'position' => 1]);
    DB::table('dimension_values')->insert(['id' => $fund, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'dimension_id' => $dimension, 'code' => 'RESTRICTED', 'name' => 'Restricted']);

    postJournal($this->f, draftJournal($this->f, [new DraftLine($this->f->account('1000'), debit: 7000), new DraftLine($this->f->account('4000'), credit: 7000, dims: [1 => $fund])], '2026-02-10'));
    cashSale($this->f, 3000, '2026-02-11'); // no fund: unrestricted
    closeAllMonths($this->f);

    $closing = app(YearEndClose::class)->handle(signer($this->f), $this->f->period('2026-01-15')->fiscal_year_id);

    $byFund = fn (string $code) => $closing?->lines()->where('account_id', $this->f->account($code))->get()
        ->mapWithKeys(fn ($l) => [$l->getAttribute('dim1_value_id') ?? 'none' => [$l->debit, $l->credit]])->all();
    expect($byFund('4000'))->toEqual([$fund => [7000, 0], 'none' => [3000, 0]])
        ->and($byFund('3000'))->toEqual([$fund => [0, 7000], 'none' => [0, 3000]]);
});

it('locks the year only after the year-end close with every period closed, and then nothing posts', function (): void {
    cashSale($this->f, 10000, '2026-02-10');
    closeAllMonths($this->f);
    $yearId = $this->f->period('2026-01-15')->fiscal_year_id;

    expect(fn () => app(LockFiscalYear::class)->handle(signer($this->f), $yearId))->toThrow(DomainRuleViolation::class, 'year-end close');
    app(YearEndClose::class)->handle(signer($this->f), $yearId);
    expect(fn () => app(LockFiscalYear::class)->handle(signer($this->f), $yearId))->toThrow(DomainRuleViolation::class, 'adjustment period included');

    app(ClosePeriod::class)->handle(signer($this->f), new ClosePeriodInput($this->f->adjustmentPeriod()->id));
    expect(app(LockFiscalYear::class)->handle(signer($this->f), $yearId)->status)->toBe('locked')
        ->and(FiscalPeriod::query()->where('fiscal_year_id', $yearId)->pluck('status')->unique()->map(fn ($s) => $s->value)->all())->toBe(['locked']);

    expect(fn () => app(RequestPeriodReopen::class)->handle($this->f->actor, $this->f->period('2026-03-15')->id, 'too late'))->toThrow(DomainRuleViolation::class);
    expect(fn () => app(YearEndClose::class)->handle(signer($this->f), $yearId))->toThrow(DomainRuleViolation::class, 'locked');
});

it('refuses period changes from API clients and people without the permission', function (): void {
    $api = new Actor(ActorType::ApiClient, (string) Str::uuid7(), $this->f->tenantId, $this->f->companyId);
    expect(fn () => app(SoftClosePeriod::class)->handle($api, $this->f->period('2026-03-15')->id))->toThrow(DomainRuleViolation::class, 'Only a person');

    $this->grant();
    expect(fn () => app(SoftClosePeriod::class)->handle($this->f->actor, $this->f->period('2026-03-15')->id))->toThrow(DomainRuleViolation::class, 'periods.close');
});
