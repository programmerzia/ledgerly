<?php

declare(strict_types=1);

namespace App\Queries\Tax;

use App\Models\Tax\TaxCode;
use Illuminate\Database\Eloquent\Builder;

/** The company's tax codes with their rates; the caller paginates (by code). */
final class ListTaxCodes
{
    /** @return Builder<TaxCode> */
    public function __invoke(string $companyId, ?string $kind = null, ?bool $active = null): Builder
    {
        $query = TaxCode::query()->with('rates')->where('company_id', $companyId);
        if ($kind !== null) {
            $query->where('kind', $kind);
        }
        if ($active !== null) {
            $query->where('is_active', $active);
        }

        return $query;
    }
}
