<?php

declare(strict_types=1);

namespace App\Queries\Fx;

use App\Domain\Fx\CrossRates;
use App\Domain\Fx\RateQuote;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Models\Fx\ExchangeRate;

/**
 * The latest rate on or before a date for a currency pair. Rates quoted on documents (`source = document`)
 * are not market rates and never answer this. A manual rate beats a provider rate struck for the same day.
 * When only the opposite pair is stored, its reciprocal is used (at the stored scale).
 */
final class FindExchangeRate
{
    public function find(string $companyId, string $from, string $to, string $onOrBefore): ?RateQuote
    {
        $direct = $this->latest($companyId, $from, $to, $onOrBefore);
        $opposite = $this->latest($companyId, $to, $from, $onOrBefore);

        if ($direct !== null && ($opposite === null || $direct->rate_date >= $opposite->rate_date)) {
            return new RateQuote($from, $to, $direct->rate, $direct->rate_date->format('Y-m-d'), $direct->source);
        }
        if ($opposite !== null) {
            return new RateQuote($from, $to, CrossRates::inverse($opposite->rate), $opposite->rate_date->format('Y-m-d'), $opposite->source, inverted: true);
        }

        return null;
    }

    /** @throws DomainRuleViolation fx_rate_missing */
    public function require(string $companyId, string $from, string $to, string $onOrBefore): RateQuote
    {
        return $this->find($companyId, $from, $to, $onOrBefore)
            ?? throw new DomainRuleViolation('fx_rate_missing', "No {$from}/{$to} rate on or before {$onOrBefore}.", [
                new Violation('fx_rate_missing', "No {$from}/{$to} rate on or before {$onOrBefore}."),
            ]);
    }

    private function latest(string $companyId, string $from, string $to, string $onOrBefore): ?ExchangeRate
    {
        return ExchangeRate::query()
            ->where('company_id', $companyId)->where('from_currency', $from)->where('to_currency', $to)
            ->where('rate_date', '<=', $onOrBefore)->whereIn('source', ['manual', 'provider'])
            ->orderByDesc('rate_date')->orderByRaw("CASE source WHEN 'manual' THEN 0 ELSE 1 END")->orderByDesc('created_at')
            ->first();
    }
}
