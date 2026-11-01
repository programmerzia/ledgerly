<?php

declare(strict_types=1);

namespace App\Services\Fx;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fx\FxRevaluation;
use App\Models\Organisation\Company;

/** FX_REVAL: the period has its revaluation run, or has no foreign monetary balance that would change. */
final class FxRevaluationCheck implements PeriodCloseCheck
{
    public function __construct(private readonly FxRevaluationCalculator $calculator) {}

    public function code(): string
    {
        return 'FX_REVAL';
    }

    public function run(FiscalPeriod $period): CheckOutcome
    {
        if ($period->kind !== 'regular') {
            return new CheckOutcome($this->code(), true, 'The adjustment period is not revalued.');
        }
        $done = FxRevaluation::query()->where('company_id', $period->company_id)->where('fiscal_period_id', $period->id)
            ->whereNotIn('status', ['void', 'reversed'])->exists();
        if ($done) {
            return new CheckOutcome($this->code(), true, 'The FX revaluation has been run.');
        }

        $company = Company::query()->findOrFail($period->company_id);
        $plan = $this->calculator->plan($company->id, $company->base_currency, $period->ends_on->format('Y-m-d'));
        if ($plan->missingRates !== []) {
            return new CheckOutcome($this->code(), false, 'Closing rates are missing for '.implode(', ', $plan->missingRates).'; add them and run the FX revaluation.', ['missing_rates' => $plan->missingRates]);
        }
        if ($plan->isEmpty()) {
            return new CheckOutcome($this->code(), true, 'No foreign balance needs revaluing.');
        }

        return new CheckOutcome($this->code(), false, count($plan->items).' foreign balance(s) need the FX revaluation.', ['items' => count($plan->items), 'total_unrealised' => $plan->total()]);
    }
}
