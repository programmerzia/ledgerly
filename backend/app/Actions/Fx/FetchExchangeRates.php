<?php

declare(strict_types=1);

namespace App\Actions\Fx;

use App\Contracts\Clock;
use App\Contracts\ExchangeRateProvider;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Fx\CrossRates;
use App\Domain\Fx\ProviderRates;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fx\ExchangeRate;
use App\Models\Ledger\Account;
use App\Models\Ledger\JournalLine;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Fx\RateProviderFailed;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\Log;

/**
 * Pulls the day's provider rates into a company: for every foreign currency the company uses (journal lines,
 * fixed-currency accounts, rates it already holds) the rate to its base currency, cross-derived from the feed.
 * Idempotent per pair and day (an existing provider rate is kept). The HTTP call happens before any
 * transaction; a provider failure is logged and reported in the result, and nothing changes.
 */
final class FetchExchangeRates
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly ExchangeRateProvider $provider,
        private readonly PermissionChecker $permissions,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
    ) {}

    /** @param ProviderRates|null $feed a feed already fetched by the caller (the daily job fetches once per tenant) */
    public function handle(Actor $actor, string $companyId, ?ProviderRates $feed = null): FetchResult
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person or the scheduler can fetch provider rates.');
        }
        if ($actor->type === ActorType::User && ! $this->permissions->allows($actor, 'fx.manage', $companyId)) {
            throw DomainRuleViolation::single('forbidden', 'This needs the fx.manage permission.');
        }

        $name = $this->provider->name();
        if ($feed === null) {
            try {
                $feed = $this->provider->latest();
            } catch (RateProviderFailed $e) {
                Log::warning('Exchange-rate fetch failed; existing rates kept.', ['provider' => $name, 'company_id' => $companyId, 'error' => $e->getMessage()]);

                return new FetchResult(0, [], null, $name, $e->getMessage());
            }
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $feed, $name) {
            $base = Company::query()->findOrFail($companyId)->base_currency;
            $rows = [];
            $skipped = [];
            $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
            foreach ($this->currenciesInUse($companyId, $base) as $currency) {
                $rate = CrossRates::rate($feed, $currency, $base);
                if ($rate === null) {
                    $skipped[] = $currency;

                    continue;
                }
                $rows[] = [
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId,
                    'from_currency' => $currency, 'to_currency' => $base, 'rate_date' => $feed->date, 'rate' => $rate,
                    'source' => 'provider', 'created_by' => $actor->id, 'created_at' => $now, 'updated_at' => $now,
                ];
            }
            $inserted = $rows === [] ? 0 : ExchangeRate::query()->insertOrIgnore($rows);
            if ($inserted > 0) {
                $audit->add('fx_rate.fetched', null, after: ['company_id' => $companyId, 'provider' => $name, 'rate_date' => $feed->date, 'inserted' => $inserted]);
            }

            return new FetchResult($inserted, $skipped, $feed->date, $name);
        });
    }

    /** @return list<string> foreign currencies, sorted */
    private function currenciesInUse(string $companyId, string $base): array
    {
        $codes = [
            ...JournalLine::query()->where('company_id', $companyId)->where('currency', '<>', $base)->distinct()->pluck('currency')->all(),
            ...Account::query()->where('company_id', $companyId)->whereNotNull('fixed_currency')->where('fixed_currency', '<>', $base)->distinct()->pluck('fixed_currency')->all(),
            ...ExchangeRate::query()->where('company_id', $companyId)->where('to_currency', $base)->distinct()->pluck('from_currency')->all(),
        ];
        $codes = array_values(array_unique(array_map(strval(...), $codes)));
        sort($codes);

        return $codes;
    }
}
