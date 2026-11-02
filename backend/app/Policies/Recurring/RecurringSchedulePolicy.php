<?php

declare(strict_types=1);

namespace App\Policies\Recurring;

use App\Models\Recurring\RecurringSchedule;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Recurring invoices, bills and journals: `recurring.view` / `recurring.manage`, tokens `recurring:read|write`. A run only
 * creates drafts, which the schedule's owner then submits for approval, so a token may run one too.
 */
final class RecurringSchedulePolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'recurring.view', 'recurring:read');
    }

    public function view(Authenticatable $principal, RecurringSchedule $schedule): bool
    {
        return $this->context->can($principal, 'recurring.view', 'recurring:read', $schedule->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'recurring.manage', 'recurring:write');
    }

    public function update(Authenticatable $principal, RecurringSchedule $schedule): bool
    {
        return $this->context->can($principal, 'recurring.manage', 'recurring:write', $schedule->company_id);
    }

    public function pause(Authenticatable $principal, RecurringSchedule $schedule): bool
    {
        return $schedule->is_active && $this->update($principal, $schedule);
    }

    public function resume(Authenticatable $principal, RecurringSchedule $schedule): bool
    {
        return ! $schedule->is_active && $this->update($principal, $schedule);
    }

    public function run(Authenticatable $principal): bool
    {
        return $this->create($principal);
    }
}
