<?php

declare(strict_types=1);

namespace App\Queries\Fx;

use App\Models\Fx\FxRevaluation;
use Illuminate\Database\Eloquent\Builder;

/** The company's revaluation runs; the caller paginates (by as-of date, newest first). */
final class ListFxRevaluations
{
    /** @return Builder<FxRevaluation> */
    public function __invoke(string $companyId, ?string $periodId = null): Builder
    {
        $query = FxRevaluation::query()->where('company_id', $companyId);
        if ($periodId !== null) {
            $query->where('fiscal_period_id', $periodId);
        }

        return $query;
    }
}
