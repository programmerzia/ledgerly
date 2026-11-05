<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Models\FixedAssets\FixedAsset;
use Illuminate\Database\Eloquent\Builder;

/** The register, filtered; the caller paginates (by number). */
final class ListFixedAssets
{
    /** @return Builder<FixedAsset> */
    public function __invoke(string $companyId, ?string $categoryId, ?string $status, ?string $search): Builder
    {
        $query = FixedAsset::query()->with('category:id,name')->where('company_id', $companyId);
        if ($categoryId !== null) {
            $query->where('category_id', $categoryId);
        }
        if ($status === 'active' || $status === 'disposed') {
            $query->where('status', $status);
        } elseif ($status === 'fully_depreciated') {
            $query->where('status', 'active')->whereRaw('cost - accumulated_depreciation - accumulated_impairment <= residual');
        }
        if ($search !== null && $search !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search).'%';
            $query->where(fn (Builder $q) => $q->where('name', 'ilike', $like)->orWhere('number', 'ilike', $like));
        }

        return $query;
    }
}
