<?php

declare(strict_types=1);

use App\Actions\Fx\FetchExchangeRates;
use App\Actions\Fx\ReverseFxRevaluation;
use App\Contracts\ExchangeRateProvider;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Jobs\Fx\FetchTenantExchangeRates;
use App\Models\Fx\ExchangeRate;
use App\Queries\Fx\FindExchangeRate;
use App\Services\Fx\EcbRateProvider;
use App\Support\Actor;
use App\Support\Fx\RateProviderFailed;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Tests\Support\FakeRateProvider;
use Tests\Support\FxScenario as S;
use Tests\Support\LedgerFixture;

const ECB_XML = <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time="2026-03-31">
      <Cube currency="USD" rate="1.0850"/>
      <Cube currency="JPY" rate="161.50"/>
      <Cube currency="GBP" rate="0.8412"/>
    </Cube>
  </Cube>
</gesmes:Envelope>
XML;

beforeEach(function () {
    Http::preventStrayRequests();
    $this->f = LedgerFixture::create();
    S::prepare($this->f);
    $this->fake = new FakeRateProvider;
    $this->app->instance(ExchangeRateProvider::class, $this->fake);
    $this->system = Actor::system($this->f->tenantId, $this->f->companyId);
    // The company uses EUR (a fixed-currency account exists) and GBP (a posted line).
    S::post($this->f, JournalType::Sales, [S::fc($this->f, '1100', 'GBP', 10000, '1.20000000', 12000, S::C1), new DraftLine($this->f->account('4000'), credit: 12000)], '2026-03-10');
});

it('parses the ECB daily XML into exact decimal strings', function () {
    Http::fake(['*' => Http::response(ECB_XML)]);

    $rates = app(EcbRateProvider::class)->latest();

    expect($rates->date)->toBe('2026-03-31')->and($rates->base)->toBe('EUR')
        ->and($rates->rates)->toBe(['USD' => '1.0850', 'JPY' => '161.50', 'GBP' => '0.8412']);
    Http::assertSentCount(1);
});

it('raises RateProviderFailed on an outage or a malformed feed', function (string $body, int $status) {
    Http::fake(['*' => Http::response($body, $status)]);

    expect(fn () => app(EcbRateProvider::class)->latest())->toThrow(RateProviderFailed::class);
})->with([
    'server error' => ['oops', 500],
    'not xml' => ['<html>', 200],
    'no rates' => ['<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-03-31"/></Cube></gesmes:Envelope>', 200],
]);

it('stores cross rates to the base currency for the currencies the company uses, once per day', function () {
    // USD base; EUR (fixed-currency bank account) and GBP (a posted line) in use. 1 GBP = 1.25 / 0.8 = 1.5625 USD.
    $result = app(FetchExchangeRates::class)->handle($this->system, $this->f->companyId);

    expect($result->inserted)->toBe(2)->and($result->error)->toBeNull()
        ->and(ExchangeRate::query()->where('source', 'provider')->orderBy('from_currency')->get()->map(fn ($r) => [$r->from_currency, $r->to_currency, $r->rate_date->format('Y-m-d'), $r->rate])->all())
        ->toBe([['EUR', 'USD', '2026-03-31', '1.25000000'], ['GBP', 'USD', '2026-03-31', '1.56250000']]);

    expect(app(FetchExchangeRates::class)->handle($this->system, $this->f->companyId)->inserted)->toBe(0);   // idempotent per day
    expect(app(FindExchangeRate::class)->require($this->f->companyId, 'GBP', 'USD', '2026-04-05')->rate)->toBe('1.56250000');
});

it('keeps a manual rate ahead of the provider rate for the same day', function () {
    S::rate($this->f, 'GBP', '2026-03-31', '1.60000000');
    app(FetchExchangeRates::class)->handle($this->system, $this->f->companyId);

    $quote = app(FindExchangeRate::class)->require($this->f->companyId, 'GBP', 'USD', '2026-03-31');

    expect($quote->rate)->toBe('1.60000000')->and($quote->source)->toBe('manual');
});

it('logs a provider failure and leaves existing rates alone', function () {
    S::rate($this->f, 'GBP', '2026-03-30', '1.55000000');
    $this->fake->fail = true;
    Log::spy();

    $result = app(FetchExchangeRates::class)->handle($this->system, $this->f->companyId);

    expect($result->error)->toBe('fake outage')->and($result->inserted)->toBe(0)->and(ExchangeRate::query()->count())->toBe(1);
    Log::shouldHaveReceived('warning')->once();
});

it('raises fx_rate_missing from the lookup when nothing is on or before the date', function () {
    S::rate($this->f, 'GBP', '2026-04-01', '1.60000000');

    expect(fn () => app(FindExchangeRate::class)->require($this->f->companyId, 'GBP', 'USD', '2026-03-31'))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'fx_rate_missing');
});

it('queues one fetch per live tenant from the scheduled command', function () {
    Queue::fake();
    app(TenantContext::class)->clear();

    $this->artisan('fx:fetch-rates')->assertSuccessful();

    Queue::assertPushed(FetchTenantExchangeRates::class, fn ($job) => $job->tenantId() === $this->f->tenantId);
    expect(collect(app(Schedule::class)->events())->contains(fn ($e) => str_contains($e->command, 'fx:fetch-rates')))->toBeTrue();
});

it('runs the daily job: fetches once for the tenant, and still retries pending reversals when the provider is down', function () {
    $job = new FetchTenantExchangeRates($this->f->tenantId);
    $handle = fn () => app()->call([$job, 'handle']);

    $handle();
    expect($this->fake->calls)->toBe(1)->and(ExchangeRate::query()->where('source', 'provider')->count())->toBe(2);

    $this->fake->fail = true;
    $handle();   // outage: logged, no exception, nothing changes
    expect(ExchangeRate::query()->count())->toBe(2);
    expect(app(ReverseFxRevaluation::class)->pending($this->f->tenantId, $this->f->companyId))->toBe(0);
});
