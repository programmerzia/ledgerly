<?php

declare(strict_types=1);

use App\Contracts\ExchangeRateProvider;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Models\Fx\ExchangeRate;
use Tests\Support\FakeRateProvider;
use Tests\Support\FxScenario as S;

beforeEach(function (): void {
    $this->setUpWorld();
    $this->owner = $this->person('Olga Owner', ['Owner']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->inTenant(function (): void {
        S::prepare($this->f);
        S::post($this->f, JournalType::Bank, [S::fc($this->f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($this->f->account('4000'), credit: 110000)], '2026-03-10');
    });
    $this->fake = new FakeRateProvider;
    $this->app->instance(ExchangeRateProvider::class, $this->fake);
    $this->period = fn (string $date = '2026-03-15') => $this->inTenant(fn () => $this->f->period($date)->id);
    $this->rateBody = ['from_currency' => 'EUR', 'to_currency' => 'USD', 'rate_date' => '2026-03-31', 'rate' => '1.12000000'];
});

it('enters a manual rate, lists rates with a cursor, and corrects a rate no run has used', function (): void {
    $this->asPerson($this->owner);
    $this->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertCreated()
        ->assertJsonPath('data.rate', '1.12000000')->assertJsonPath('data.source', 'manual')->assertJsonPath('data.from_currency', 'EUR');
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'rate_date' => '2026-03-30', 'rate' => '1.11000000'], $this->key())->assertCreated();

    $page = $this->getJson($this->api('fx-rates?limit=1'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.rate_date', '2026-03-31');
    $this->getJson($this->api('fx-rates?limit=1&cursor='.$page->json('meta.next_cursor')))->assertOk()->assertJsonPath('data.0.rate_date', '2026-03-30');
    $this->getJson($this->api('fx-rates?from=GBP'))->assertOk()->assertJsonCount(0, 'data');

    // Same pair and day again = a correction.
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'rate' => '1.13000000'], $this->key())->assertCreated();
    expect($this->inTenant(fn () => ExchangeRate::query()->where('rate_date', '2026-03-31')->pluck('rate')->all()))->toBe(['1.13000000']);
});

it('validates a rate and refuses a viewer', function (): void {
    $this->asPerson($this->owner);
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'rate' => '0'], $this->key())->assertStatus(422);
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'rate' => '1.123456789'], $this->key())->assertStatus(422);
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'to_currency' => 'EUR'], $this->key())->assertStatus(422);
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'from_currency' => 'ZZZ'], $this->key())->assertStatus(422);

    $this->asPerson($this->viewer);
    $this->getJson($this->api('fx-rates'))->assertOk();
    $this->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertForbidden();
    $this->postJson($this->api('fx-rates/fetch'), [], $this->key())->assertForbidden();
});

it('fetches provider rates, and answers 502 without touching rates when the provider is down', function (): void {
    $this->asPerson($this->owner);
    $this->postJson($this->api('fx-rates/fetch'), [], $this->key())->assertOk()
        ->assertJsonPath('data.provider', 'fake')->assertJsonPath('data.inserted', 1)->assertJsonPath('data.rate_date', '2026-03-31');
    $this->getJson($this->api('fx-rates?source=provider'))->assertOk()->assertJsonPath('data.0.rate', '1.25000000');

    $this->fake->fail = true;
    $this->postJson($this->api('fx-rates/fetch'), [], $this->key())->assertStatus(502)->assertJsonPath('code', 'fx_provider_unavailable');
    $this->getJson($this->api('fx-rates'))->assertJsonCount(1, 'data');
});

it('previews, then runs with a signing grant; a second run is refused', function (): void {
    $period = ($this->period)();
    $this->asPerson($this->owner)->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertCreated();

    $this->getJson($this->api("fx-revaluations/preview?period_id={$period}"))->assertOk()
        ->assertJsonPath('data.can_run', true)->assertJsonPath('data.as_of', '2026-03-31')
        ->assertJsonPath('data.total_unrealised', ['amount' => 2000, 'currency' => 'USD'])
        ->assertJsonPath('data.items.0.revalued_base.amount', 112000)->assertJsonPath('data.items.0.closing_rate', '1.12000000');
    $this->getJson($this->api('fx-revaluations'))->assertOk()->assertJsonCount(0, 'data');   // no side effects

    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertForbidden()->assertJsonPath('code', 'signature_required');

    $this->asPerson($this->owner, signing: true);
    $run = $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertCreated()
        ->assertJsonPath('data.status', 'posted')->assertJsonPath('data.total_unrealised.amount', 2000)
        ->assertJsonPath('data.reversal_pending', false)->assertJsonPath('data.items.0.unrealised.amount', 2000);
    $this->getJson($this->api('journals/'.$run->json('data.journal_id')))->assertOk()->assertJsonPath('data.journal_type', 'fx');
    $this->getJson($this->api('journals/'.$run->json('data.reversal_journal_id')))->assertOk()->assertJsonPath('data.journal_date', '2026-04-01');
    $this->getJson($this->api("fx-revaluations?period_id={$period}"))->assertOk()->assertJsonCount(1, 'data');

    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertStatus(422)->assertJsonPath('code', 'fx_revaluation_exists');
    $this->getJson($this->api("fx-revaluations/preview?period_id={$period}"))->assertOk()->assertJsonPath('data.can_run', false)
        ->assertJsonPath('data.blockers', ['fx_revaluation_exists']);
});

it('refuses a missing rate and a closed period', function (): void {
    $period = ($this->period)();
    $this->asPerson($this->owner, signing: true);

    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertStatus(422)->assertJsonPath('code', 'fx_rate_missing');

    $this->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertCreated();
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-03-15', 'closed'));
    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertStatus(422)->assertJsonPath('code', 'period_closed');
});

it('shows the revaluation as a check on the period close list', function (): void {
    $period = ($this->period)();
    $this->asPerson($this->owner);

    $this->getJson($this->api("fiscal-periods/{$period}/close-checks"))->assertOk()
        ->assertJsonFragment(['code' => 'FX_REVAL', 'passed' => false]);
});

it('lets a read token see rates and runs but nothing else', function (): void {
    $period = ($this->period)();
    $this->asPerson($this->owner)->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertCreated();

    $this->asToken($this->newToken(['fx:read']));
    $this->getJson($this->api('fx-rates'))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->api('fx-revaluations'))->assertOk();
    $this->getJson($this->api("fx-revaluations/preview?period_id={$period}"))->assertOk();
    $this->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertForbidden();
    $this->postJson($this->api('fx-rates/fetch'), [], $this->key())->assertForbidden();
    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertForbidden();

    // Even a token that says everything never runs a revaluation or fetches the feed.
    $this->asToken($this->newToken(['*']));
    $this->postJson($this->api('fx-revaluations'), ['period_id' => $period], $this->key())->assertForbidden();
    $this->postJson($this->api('fx-rates'), [...$this->rateBody, 'rate_date' => '2026-03-29'], $this->key())->assertCreated();   // fx:write via '*'
});

it('keeps another company out: its period is a 404 and its rates are invisible', function (): void {
    $beta = $this->secondCompany();
    $betaOwner = $this->person('Bea Beta', ['Owner'], $beta->id);

    $this->asPerson($this->owner, signing: true)->postJson($this->api('fx-rates'), $this->rateBody, $this->key())->assertCreated();
    // Company B has no fiscal year here; use company A's period id through B's URL: not B's, so 404.
    $periodOfA = ($this->period)();
    $this->asPerson($betaOwner, signing: true);
    $this->getJson($this->api('fx-rates', $beta->id))->assertOk()->assertJsonCount(0, 'data');
    $this->postJson($this->api('fx-revaluations', $beta->id), ['period_id' => $periodOfA], $this->key())->assertNotFound();
    $this->getJson($this->api("fx-revaluations/preview?period_id={$periodOfA}", $beta->id))->assertNotFound();

    // And A's owner cannot reach B at all.
    $this->asPerson($this->owner, signing: true);
    $this->getJson($this->api('fx-rates', $beta->id))->assertForbidden();
});
