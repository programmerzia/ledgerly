<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Dimension;
use Illuminate\Database\Eloquent\Collection;

/** The company's dimensions in position order, each with its values. */
final class ListDimensions
{
    /** @return Collection<int, Dimension> */
    public function __invoke(string $companyId): Collection
    {
        return Dimension::query()->where('company_id', $companyId)->with('values')->orderBy('position')->get();
    }
}
