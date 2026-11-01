<?php

declare(strict_types=1);

namespace App\Queries\Tax;

use App\Models\Tax\TaxGroup;
use Illuminate\Database\Eloquent\Builder;

/** The company's tax groups with their items in sequence; the caller paginates (by code). */
final class ListTaxGroups
{
    /** @return Builder<TaxGroup> */
    public function __invoke(string $companyId, ?bool $active = null): Builder
    {
        $query = TaxGroup::query()->with('items')->where('company_id', $companyId);
        if ($active !== null) {
            $query->where('is_active', $active);
        }

        return $query;
    }
}
