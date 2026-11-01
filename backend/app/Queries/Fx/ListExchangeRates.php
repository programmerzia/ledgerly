<?php

declare(strict_types=1);

namespace App\Queries\Fx;

use App\Models\Fx\ExchangeRate;
use Illuminate\Database\Eloquent\Builder;

/** The company's rate table, filtered; the caller paginates (newest rate date first). */
final class ListExchangeRates
{
    /** @return Builder<ExchangeRate> */
    public function __invoke(string $companyId, ?string $from = null, ?string $to = null, ?string $source = null, ?string $dateFrom = null, ?string $dateTo = null): Builder
    {
        $query = ExchangeRate::query()->where('company_id', $companyId);
        if ($from !== null) {
            $query->where('from_currency', $from);
        }
        if ($to !== null) {
            $query->where('to_currency', $to);
        }
        if ($source !== null) {
            $query->where('source', $source);
        }
        if ($dateFrom !== null) {
            $query->where('rate_date', '>=', $dateFrom);
        }
        if ($dateTo !== null) {
            $query->where('rate_date', '<=', $dateTo);
        }

        return $query;
    }
}
