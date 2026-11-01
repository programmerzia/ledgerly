<?php

declare(strict_types=1);

namespace App\Queries\Fx;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fx\FxRevaluation;
use App\Models\Organisation\Company;
use App\Services\Fx\FxRevaluationCalculator;

/**
 * What a revaluation of the period would do right now: the plan, and what would stop it. No locks and no writes;
 * the run re-calculates under the period lock, so the figures here can differ if something posts in between.
 */
final class PreviewFxRevaluation
{
    public function __construct(private readonly FxRevaluationCalculator $calculator) {}

    public function __invoke(string $companyId, string $periodId, ?string $asOf = null): RevaluationPreview
    {
        $period = FiscalPeriod::query()->where('company_id', $companyId)->find($periodId)
            ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');
        $start = $period->starts_on->format('Y-m-d');
        $end = $period->ends_on->format('Y-m-d');
        $day = $asOf ?? $end;
        if ($day < $start || $day > $end) {
            throw DomainRuleViolation::single('fx_as_of_outside_period', "The as-of date must fall within {$start} and {$end}.");
        }

        $company = Company::query()->findOrFail($companyId);
        $plan = $this->calculator->plan($companyId, $company->base_currency, $day);
        $existing = FxRevaluation::query()->where('company_id', $companyId)->where('fiscal_period_id', $period->id)->whereNotIn('status', ['void', 'reversed'])->first();

        $blockers = [];
        if ($period->kind !== 'regular') {
            $blockers[] = 'fx_period_invalid';
        }
        if (! in_array($period->status->value, ['open', 'soft_closed'], true)) {
            $blockers[] = 'period_closed';
        }
        if ($existing !== null) {
            $blockers[] = 'fx_revaluation_exists';
        }
        if ($plan->missingRates !== []) {
            $blockers[] = 'fx_rate_missing';
        }

        return new RevaluationPreview($period->id, $plan, $existing?->id, $blockers);
    }
}
