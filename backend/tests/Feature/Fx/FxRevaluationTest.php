<?php

declare(strict_types=1);

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Actions\Fx\Inputs\RunFxRevaluationInput;
use App\Actions\Fx\ReverseFxRevaluation;
use App\Actions\Fx\RunFxRevaluation;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fx\ExchangeRate;
use App\Models\Fx\FxRevaluation;
use App\Models\Ledger\Journal;
use App\Queries\Fx\PreviewFxRevaluation;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\FxScenario as S;
use Tests\Support\LedgerFixture;

beforeEach(function () {
    $this->f = LedgerFixture::create();
    S::prepare($this->f);
    $this->system = Actor::system($this->f->tenantId, $this->f->companyId);
    $this->run = fn (string $date = '2026-03-15', ?string $asOf = null) => app(RunFxRevaluation::class)
        ->handle($this->system, new RunFxRevaluationInput($this->f->companyId, $this->f->period($date)->id, $asOf));
    $this->expectCode = function (Closure $work, string $code): DomainRuleViolation {
        try {
            $work();
        } catch (DomainRuleViolation $e) {
            expect($e->errorCode)->toBe($code);

            return $e;
        }
        throw new RuntimeException("Expected {$code}");
    };
});

it('books an unrealised gain on a EUR bank balance and reverses it on the first day of the next period', function () {
    $f = $this->f;
    // EUR 1,000.00 at 1.10 = USD 1,100.00 carried; closing rate 1.12 -> 1,120.00.
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');

    $run = ($this->run)();
    $journal = Journal::query()->findOrFail($run->journal_id);

    expect($run->status)->toBe('posted')->and($run->total_unrealised)->toBe(2000)
        ->and($run->as_of->format('Y-m-d'))->toBe('2026-03-31')
        ->and($journal->journal_type)->toBe(JournalType::Fx)->and($journal->journal_date->format('Y-m-d'))->toBe('2026-03-31')
        ->and($journal->source_type)->toBe('fx_revaluation')->and($journal->source_id)->toBe($run->id)
        ->and(S::lines($f, $journal->id))->toBe([
            ['account' => '1200', 'debit' => 2000, 'credit' => 0, 'currency' => 'EUR', 'contact' => null],
            ['account' => '7900', 'debit' => 0, 'credit' => 2000, 'currency' => 'USD', 'contact' => null],
        ])
        ->and($run->detail['rows'][0])->toMatchArray(['amount_fc' => 100000, 'closing_rate' => '1.12000000', 'carried_base' => 110000, 'revalued_base' => 112000, 'unrealised' => 2000]);

    // The reversal is dated the first day of April (D3) and nets the adjustment to zero.
    $reversal = Journal::query()->findOrFail($run->reversal_journal_id);
    expect($reversal->journal_date->format('Y-m-d'))->toBe('2026-04-01')->and($reversal->journal_type)->toBe(JournalType::Reversal)
        ->and($reversal->fiscal_period_id)->toBe($f->period('2026-04-15')->id)
        ->and($journal->refresh()->status)->toBe(JournalStatus::Reversed)
        ->and($run->isReversalPending())->toBeFalse()
        ->and(S::base($f, '1200'))->toBe(110000)->and(S::base($f, '7900'))->toBe(0);
});

it('books a loss on a EUR payable per supplier (credit balance revalued up)', function () {
    $f = $this->f;
    // Owe EUR 500.00 at 1.08 = 540.00; at 1.12 = 560.00: loss of 20.00 on the supplier's balance.
    S::post($f, JournalType::Purchase, [new DraftLine($f->account('5000'), debit: 54000), S::fc($f, '2000', 'EUR', -50000, '1.08000000', -54000, S::C1)], '2026-03-05');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');

    $run = ($this->run)();

    expect($run->total_unrealised)->toBe(-2000)->and(S::lines($f, (string) $run->journal_id))->toBe([
        ['account' => '2000', 'debit' => 0, 'credit' => 2000, 'currency' => 'EUR', 'contact' => S::C1],
        ['account' => '7900', 'debit' => 2000, 'credit' => 0, 'currency' => 'USD', 'contact' => null],
    ]);
});

it('revalues several currencies and each customer on its own, skipping zero differences', function () {
    $f = $this->f;
    S::post($f, JournalType::Sales, [
        S::fc($f, '1100', 'GBP', 20000, '1.25000000', 25000, S::C1),   // GBP 200.00 -> 1.2575 = 251.50: +1.50
        S::fc($f, '1100', 'EUR', 10000, '1.10000000', 11000, S::C2),   // EUR 100.00 -> 1.12 = 112.00: +2.00
        S::fc($f, '1100', 'EUR', 5000, '1.12000000', 5600, S::C3),     // EUR 50.00 already at 1.12: zero, skipped
        new DraftLine($f->account('4000'), credit: 41600),
    ], '2026-03-12');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');
    S::rate($f, 'GBP', '2026-03-30', '1.25750000');   // latest on or before the as-of date

    $run = ($this->run)();

    expect($run->total_unrealised)->toBe(350)
        ->and(S::lines($f, (string) $run->journal_id))->toBe([
            ['account' => '1100', 'debit' => 200, 'credit' => 0, 'currency' => 'EUR', 'contact' => S::C2],
            ['account' => '7900', 'debit' => 0, 'credit' => 200, 'currency' => 'USD', 'contact' => null],
            ['account' => '1100', 'debit' => 150, 'credit' => 0, 'currency' => 'GBP', 'contact' => S::C1],
            ['account' => '7900', 'debit' => 0, 'credit' => 150, 'currency' => 'USD', 'contact' => null],
        ])
        ->and($run->detail['rows'])->toHaveCount(3)->and($run->detail['skipped_zero'])->toBe(1);
});

it('rounds the revalued amount once, HALF_UP (D1)', function () {
    $f = $this->f;
    // EUR 0.05 carried at USD 0.05; 5 * 1.10 = 5.5 minor units -> 6, a gain of 1.
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 5, '1.00000000', 5), new DraftLine($f->account('4000'), credit: 5)], '2026-03-02');
    S::rate($f, 'EUR', '2026-03-31', '1.10000000');

    expect(($this->run)()->total_unrealised)->toBe(1);
});

it('leaves non-monetary accounts alone (IAS 21): fixed assets keep their historical rate', function () {
    $f = $this->f;
    // EUR 1,400.00 received, then equipment bought for EUR 1,000.00 out of the EUR bank account.
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 140000, '1.10000000', 154000), new DraftLine($f->account('4000'), credit: 154000)], '2026-03-02');
    S::post($f, JournalType::Bank, [S::fc($f, '1500', 'EUR', 100000, '1.10000000', 110000), S::fc($f, '1200', 'EUR', -100000, '1.10000000', -110000)], '2026-03-03');
    S::rate($f, 'EUR', '2026-03-31', '1.20000000');

    $run = ($this->run)();

    // Only the bank's EUR 400.00 (44,000 -> 48,000) moves; the EUR 1,000.00 of equipment does not.
    expect($run->total_unrealised)->toBe(4000)
        ->and(array_column(S::lines($f, (string) $run->journal_id), 'account'))->toBe(['1200', '7900'])
        ->and(S::base($f, '1500'))->toBe(110000);
});

it('records a run with nothing to adjust and then refuses a second run for the period', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.10000000');

    $run = ($this->run)();
    expect($run->journal_id)->toBeNull()->and($run->total_unrealised)->toBe(0)->and($run->isReversalPending())->toBeFalse();

    ($this->expectCode)(fn () => ($this->run)(), 'fx_revaluation_exists');
});

it('refuses a second run in the database as well (partial unique index)', function () {
    $f = $this->f;
    $run = ($this->run)();
    $row = DB::table('fx_revaluations')->where('id', $run->id)->first();

    expect(fn () => DB::table('fx_revaluations')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $row->tenant_id, 'company_id' => $row->company_id, 'fiscal_period_id' => $row->fiscal_period_id,
        'as_of' => $row->as_of, 'status' => 'posted', 'base_currency' => 'USD',
    ]))->toThrow(QueryException::class);

    // A void or reversed run frees the period.
    DB::table('fx_revaluations')->where('id', $run->id)->update(['status' => 'void']);
    expect(($this->run)()->id)->not->toBe($run->id);
});

it('refuses a closed period and posts nothing', function () {
    $f = $this->f;
    $f->setPeriodStatus('2026-03-15', 'closed');

    ($this->expectCode)(fn () => ($this->run)(), 'period_closed');
    expect(FxRevaluation::query()->count())->toBe(0);
});

it('refuses with fx_rate_missing and leaves the ledger untouched', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-04-02', '1.12000000');   // after the as-of date: not a closing rate

    $e = ($this->expectCode)(fn () => ($this->run)(), 'fx_rate_missing');

    expect($e->violations[0]->message)->toContain('EUR/USD')->and(Journal::query()->count())->toBe(1)->and(FxRevaluation::query()->count())->toBe(0);
});

it('uses the opposite pair when only that is stored, and ignores document rates', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'USD', '2026-03-31', '0.80000000', 'EUR');                                    // 1 USD = 0.8 EUR -> EUR 1.25
    DB::table('exchange_rates')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'from_currency' => 'EUR', 'to_currency' => 'USD', 'rate_date' => '2026-03-31', 'rate' => '9.00000000', 'source' => 'document']);

    expect(($this->run)()->total_unrealised)->toBe(15000);   // 1,000 * 1.25 = 1,250.00 vs 1,100.00
});

it('previews without side effects and reports what blocks the run', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');

    $before = [Journal::query()->count(), FxRevaluation::query()->count(), ExchangeRate::query()->count()];
    $blocked = app(PreviewFxRevaluation::class)($f->companyId, $f->period('2026-03-15')->id);
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');
    $ready = app(PreviewFxRevaluation::class)($f->companyId, $f->period('2026-03-15')->id);

    expect($blocked->blockers)->toBe(['fx_rate_missing'])->and($blocked->plan->missingRates)->toBe(['EUR'])
        ->and($ready->blockers)->toBe([])->and($ready->plan->total())->toBe(2000)
        ->and([Journal::query()->count(), FxRevaluation::query()->count(), ExchangeRate::query()->count()])->toBe([$before[0], $before[1], $before[2] + 1]);
});

it('holds the period FOR UPDATE while it reads balances, so a posting cannot interleave', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');

    // A posting takes FOR KEY SHARE on the period (13 §8). From a second session, NOWAIT must fail while the run reads.
    $probe = [];
    ExchangeRate::retrieved(function () use ($f, &$probe) {
        $owner = DB::connection('pgsql_owner');
        $owner->select("SELECT set_config('app.tenant_id', ?, false)", [$f->tenantId]);   // FORCE RLS applies to the owner too
        $owner->beginTransaction();
        try {
            $owner->select('SELECT id FROM fiscal_periods WHERE id = ? FOR KEY SHARE NOWAIT', [$f->period('2026-03-15')->id]);
            $probe[] = 'acquired';
        } catch (QueryException $e) {
            $probe[] = $e->getCode();   // 55P03 lock_not_available
        } finally {
            $owner->rollBack();
        }
    });

    ($this->run)();

    expect($probe)->not->toBe([])->and(array_unique($probe))->toBe(['55P03']);
    // Once the run has committed the lock is gone.
    $owner = DB::connection('pgsql_owner');
    $owner->select("SELECT set_config('app.tenant_id', ?, false)", [$f->tenantId]);
    expect($owner->select('SELECT id FROM fiscal_periods WHERE id = ? FOR KEY SHARE NOWAIT', [$f->period('2026-03-15')->id]))->toHaveCount(1);
});

it('keeps the reversal pending until the next period exists, then posts it', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-12-10');
    S::rate($f, 'EUR', '2026-12-31', '1.12000000');

    $run = ($this->run)('2026-12-15');   // January 2027 does not exist yet
    expect($run->journal_id)->not->toBeNull()->and($run->reversal_journal_id)->toBeNull()->and($run->isReversalPending())->toBeTrue();

    app(CreateFiscalYear::class)->handle($this->system, new CreateFiscalYearInput($f->companyId, new DateTimeImmutable('2027-01-01'), 'FY2027'));
    expect(app(ReverseFxRevaluation::class)->pending($f->tenantId, $f->companyId))->toBe(1);

    $run->refresh();
    $reversal = Journal::query()->findOrFail($run->reversal_journal_id);
    expect($run->isReversalPending())->toBeFalse()->and($reversal->journal_date->format('Y-m-d'))->toBe('2027-01-01')
        ->and(S::base($f, '1200'))->toBe(110000);
    // Nothing left to do.
    expect(app(ReverseFxRevaluation::class)->pending($f->tenantId, $f->companyId))->toBe(0);
});

it('keeps the reversal pending while the next period is not open', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');
    $f->setPeriodStatus('2026-04-15', 'closed');

    $run = ($this->run)();
    expect($run->isReversalPending())->toBeTrue();

    $f->setPeriodStatus('2026-04-15', 'open');
    expect(app(ReverseFxRevaluation::class)->pending($f->tenantId, $f->companyId))->toBe(1)
        ->and($run->refresh()->isReversalPending())->toBeFalse();
});

it('revalues the next period from the net carrying amount, after the reversal has netted the first run to zero', function () {
    $f = $this->f;
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');
    S::rate($f, 'EUR', '2026-04-30', '1.13000000');

    ($this->run)();
    $april = ($this->run)('2026-04-15');

    // March's adjustment and its reversal cancel (carried 1,100.00); April: 1,000 * 1.13 = 1,130.00 -> +30.00.
    expect($april->total_unrealised)->toBe(3000)->and($april->detail['rows'][0])->toMatchArray(['amount_fc' => 100000, 'carried_base' => 110000, 'revalued_base' => 113000]);
});

it('takes its dimensions from the company settings', function () {
    $f = $this->f;
    $dim = (string) Str::uuid7();
    $val = (string) Str::uuid7();
    DB::table('dimensions')->insert(['id' => $dim, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => 'BRANCH', 'name' => 'Branch', 'position' => 1]);
    DB::table('dimension_values')->insert(['id' => $val, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'dimension_id' => $dim, 'code' => 'HQ', 'name' => 'Head office']);
    DB::table('companies')->where('id', $f->companyId)->update(['settings' => json_encode(['fx_revaluation_dimensions' => ['BRANCH' => 'HQ']])]);
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');

    $run = ($this->run)();

    expect(DB::table('journal_lines')->where('journal_id', $run->journal_id)->pluck('dim1_value_id')->all())->toBe([$val, $val]);
});

it('needs the unrealised FX account in the company settings', function () {
    $f = $this->f;
    DB::table('company_settings')->where('company_id', $f->companyId)->update(['posting_accounts' => '{}']);
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');

    ($this->expectCode)(fn () => ($this->run)(), 'posting_account_missing');
});

it('asks a person for fx.manage and a signing grant, and never an API client', function () {
    $f = $this->f;
    $in = new RunFxRevaluationInput($f->companyId, $f->period('2026-03-15')->id);
    $run = fn (Actor $a) => fn () => app(RunFxRevaluation::class)->handle($a, $in);

    ($this->expectCode)($run($f->actor), 'forbidden');            // no fx.manage (default deny)
    $this->grant('fx.manage');
    ($this->expectCode)($run($f->actor), 'signature_required');
    ($this->expectCode)($run($f->actorAs(ActorType::ApiClient)), 'forbidden');

    expect(app(RunFxRevaluation::class)->handle($f->signedActor(), $in)->created_by)->toBe($f->userId);
});
