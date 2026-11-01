<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Models\Trade\Item;
use Illuminate\Database\Eloquent\Builder;

/** The company's items, filtered; the caller paginates (by code). */
final class ListItems
{
    /** @return Builder<Item> */
    public function __invoke(string $companyId, ?string $kind = null, ?bool $active = null, ?string $search = null): Builder
    {
        $query = Item::query()->where('company_id', $companyId);
        if ($kind !== null) {
            $query->where('kind', $kind);
        }
        if ($active !== null) {
            $query->where('is_active', $active);
        }
        if ($search !== null && trim($search) !== '') {
            $like = '%'.addcslashes(trim($search), '\\%_').'%';
            $query->where(fn (Builder $q) => $q->where('code', 'ilike', $like)->orWhere('name', 'ilike', $like)->orWhere('description', 'ilike', $like));
        }

        return $query;
    }
}
