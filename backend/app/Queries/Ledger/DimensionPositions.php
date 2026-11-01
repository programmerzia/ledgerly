<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Dimension;

/** Journal lines carry dimension values in eight slots; the API speaks dimension ids. This maps one to the other. */
final class DimensionPositions
{
    /** @return array<int, string> position (1..8) → dimension id */
    public function __invoke(string $companyId): array
    {
        /** @var array<int, string> $map */
        $map = Dimension::query()->where('company_id', $companyId)->pluck('id', 'position')->all();

        return $map;
    }
}
