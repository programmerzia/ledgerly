<?php

declare(strict_types=1);

namespace App\Policies\Transfers;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Transfers\FundTransfer;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Fund transfers: tokens read (`fund-transfers:read`); people create (`transfers.create`), approve (`transfers.approve`, maker ≠ checker), receive and reverse. */
final class FundTransferPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'transfers.view', 'fund-transfers:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'transfers.create');
    }

    public function view(Authenticatable $principal, FundTransfer $t): bool
    {
        return $this->context->can($principal, 'transfers.view', 'fund-transfers:read', $t->company_id);
    }

    public function update(Authenticatable $principal, FundTransfer $t): bool
    {
        return $t->status === DocumentStatus::Draft && $this->context->personCan($principal, 'transfers.create', $t->company_id);
    }

    public function submit(Authenticatable $principal, FundTransfer $t): bool
    {
        return $this->update($principal, $t);
    }

    public function approve(Authenticatable $principal, FundTransfer $t): bool
    {
        return $principal instanceof User
            && $t->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$t->created_by, $t->submitted_by], true)
            && $this->context->allows($principal, 'transfers.approve', $t->company_id);
    }

    public function return(Authenticatable $principal, FundTransfer $t): bool
    {
        return $this->approve($principal, $t);
    }

    public function void(Authenticatable $principal, FundTransfer $t): bool
    {
        if (! $principal instanceof User || ! in_array($t->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($t->created_by === $principal->id && $this->context->allows($principal, 'transfers.create', $t->company_id))
            || $this->context->allows($principal, 'transfers.approve', $t->company_id);
    }

    public function receive(Authenticatable $principal, FundTransfer $t): bool
    {
        return $principal instanceof User && $t->status === DocumentStatus::Posted && $t->leg_state === 'in_transit'
            && $this->context->allows($principal, 'transfers.receive', $t->company_id);
    }

    public function reverse(Authenticatable $principal, FundTransfer $t): bool
    {
        return $principal instanceof User && $t->status === DocumentStatus::Posted && $this->context->allows($principal, 'transfers.reverse', $t->company_id);
    }
}
