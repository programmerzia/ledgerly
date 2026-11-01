<?php

declare(strict_types=1);

namespace App\Policies\Reports;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Reports (13 §7). Viewing needs `reports.view` (tokens: `reports:read`); exporting needs `reports.export`
 * (tokens: `reports:export`). A Sales Assistant holds neither.
 */
final class ReportPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function view(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'reports.view', 'reports:read');
    }

    public function export(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'reports.export', 'reports:export');
    }
}
