<?php

declare(strict_types=1);

namespace App\Queries\Fiscal;

use App\Models\Fiscal\FiscalPeriod;

final class ShowFiscalPeriod
{
    public function __invoke(string $periodId): FiscalPeriod
    {
        return FiscalPeriod::query()->with('pendingReopenRequest')->findOrFail($periodId);
    }
}
