<?php

declare(strict_types=1);

namespace App\Queries\Fiscal;

use App\Models\Fiscal\FiscalYear;

final class ShowFiscalYear
{
    public function __invoke(string $yearId): FiscalYear
    {
        return FiscalYear::query()->with(['periods' => fn ($q) => $q->with('pendingReopenRequest')])->findOrFail($yearId);
    }
}
