<?php

declare(strict_types=1);

namespace App\Policies\Fiscal;

use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Fiscal\ReopenRequestStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Fiscal years, periods and reopen requests (13 §7, §10). Tokens may read (`periods:read`); every change
 * of period status is a person's decision, and the Actions refuse tokens again.
 */
final class PeriodPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'periods.view', 'periods:read');
    }

    public function view(Authenticatable $principal, FiscalYear|FiscalPeriod $subject): bool
    {
        return $this->context->can($principal, 'periods.view', 'periods:read', $subject->company_id);
    }

    /** A new fiscal year is calendar setup. */
    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'settings.manage');
    }

    public function softClose(Authenticatable $principal, FiscalPeriod $period): bool
    {
        return $period->status === PeriodStatus::Open && $this->context->personCan($principal, 'periods.close', $period->company_id);
    }

    public function close(Authenticatable $principal, FiscalPeriod $period): bool
    {
        return in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)
            && $this->context->personCan($principal, 'periods.close', $period->company_id);
    }

    /** The close checklist preview needs the same right as closing. */
    public function checks(Authenticatable $principal, FiscalPeriod $period): bool
    {
        return $this->context->personCan($principal, 'periods.close', $period->company_id);
    }

    public function requestReopen(Authenticatable $principal, FiscalPeriod $period): bool
    {
        return $period->status === PeriodStatus::Closed
            && $this->context->personCan($principal, 'periods.reopen.request', $period->company_id);
    }

    public function yearEnd(Authenticatable $principal, FiscalYear $year): bool
    {
        return $year->status !== 'locked' && $this->context->personCan($principal, 'periods.year_end', $year->company_id);
    }

    public function lock(Authenticatable $principal, FiscalYear $year): bool
    {
        return $year->status === 'closed' && $this->context->personCan($principal, 'periods.year_end', $year->company_id);
    }

    public function approve(Authenticatable $principal, PeriodReopenRequest $request): bool
    {
        return $principal instanceof User
            && $request->status === ReopenRequestStatus::Pending
            && ! in_array($principal->id, [$request->requested_by, $request->first_approver], true)
            && $this->context->allows($principal, 'periods.reopen.approve', $request->company_id);
    }

    public function reject(Authenticatable $principal, PeriodReopenRequest $request): bool
    {
        return $this->approve($principal, $request);
    }
}
