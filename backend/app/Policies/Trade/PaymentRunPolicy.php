<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Trade\PaymentRun;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Payment runs: tokens read (`payment-runs:read`) and nothing else; people create (`payments.create`) and approve (`payments.approve`, maker ≠ checker). */
final class PaymentRunPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'payments.view', 'payment-runs:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'payments.create');
    }

    public function view(Authenticatable $principal, PaymentRun $run): bool
    {
        return $this->context->can($principal, 'payments.view', 'payment-runs:read', $run->company_id);
    }

    public function update(Authenticatable $principal, PaymentRun $run): bool
    {
        return $run->status === DocumentStatus::Draft && $this->context->personCan($principal, 'payments.create', $run->company_id);
    }

    public function submit(Authenticatable $principal, PaymentRun $run): bool
    {
        return $this->update($principal, $run);
    }

    public function approve(Authenticatable $principal, PaymentRun $run): bool
    {
        return $principal instanceof User
            && $run->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$run->created_by, $run->submitted_by], true)
            && $this->context->allows($principal, 'payments.approve', $run->company_id);
    }

    public function return(Authenticatable $principal, PaymentRun $run): bool
    {
        return $this->approve($principal, $run);
    }

    public function void(Authenticatable $principal, PaymentRun $run): bool
    {
        if (! $principal instanceof User || ! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($run->created_by === $principal->id && $this->context->allows($principal, 'payments.create', $run->company_id))
            || $this->context->allows($principal, 'payments.approve', $run->company_id);
    }
}
