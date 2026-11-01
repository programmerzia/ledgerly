<?php

declare(strict_types=1);

namespace App\Queries\Fiscal;

use App\Models\Fiscal\FiscalYear;
use Illuminate\Database\Eloquent\Collection;

/** The company's fiscal years, newest first, with their periods and any reopen request waiting on a period. */
final class ListFiscalYears
{
    /** @return Collection<int, FiscalYear> */
    public function __invoke(string $companyId): Collection
    {
        return FiscalYear::query()->where('company_id', $companyId)
            ->with(['periods' => fn ($q) => $q->with('pendingReopenRequest')])
            ->orderByDesc('starts_on')->get();
    }
}
