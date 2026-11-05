<?php

declare(strict_types=1);

namespace App\Policies\Transactions;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Transactions\ProvisionRun;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Provisioning runs: tokens read (`provisions:read`); people create (`provisions.create`), approve (`provisions.approve`, maker ≠ checker) and reverse. */
final class ProvisionRunPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'provisions.view', 'provisions:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'provisions.create');
    }

    public function view(Authenticatable $principal, ProvisionRun $run): bool
    {
        return $this->context->can($principal, 'provisions.view', 'provisions:read', $run->company_id);
    }

    public function submit(Authenticatable $principal, ProvisionRun $run): bool
    {
        return $run->status === DocumentStatus::Draft && $this->context->personCan($principal, 'provisions.create', $run->company_id);
    }

    public function approve(Authenticatable $principal, ProvisionRun $run): bool
    {
        return $principal instanceof User
            && $run->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$run->created_by, $run->submitted_by], true)
            && $this->context->allows($principal, 'provisions.approve', $run->company_id);
    }

    public function return(Authenticatable $principal, ProvisionRun $run): bool
    {
        return $this->approve($principal, $run);
    }

    public function void(Authenticatable $principal, ProvisionRun $run): bool
    {
        if (! $principal instanceof User || ! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($run->created_by === $principal->id && $this->context->allows($principal, 'provisions.create', $run->company_id))
            || $this->context->allows($principal, 'provisions.approve', $run->company_id);
    }

    public function reverse(Authenticatable $principal, ProvisionRun $run): bool
    {
        return $principal instanceof User && $run->status === DocumentStatus::Posted && $this->context->allows($principal, 'provisions.reverse', $run->company_id);
    }

    public function manageRates(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'provisions.manage');
    }
}
