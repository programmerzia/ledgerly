<?php

declare(strict_types=1);

namespace App\Policies\Transactions;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Transactions\WriteOff;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Write-offs: tokens read (`write-offs:read`); people create (`write_offs.create`), approve (`write_offs.approve`, maker ≠ checker) and reverse. */
final class WriteOffPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'write_offs.view', 'write-offs:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'write_offs.create');
    }

    public function view(Authenticatable $principal, WriteOff $w): bool
    {
        return $this->context->can($principal, 'write_offs.view', 'write-offs:read', $w->company_id);
    }

    public function update(Authenticatable $principal, WriteOff $w): bool
    {
        return $w->status === DocumentStatus::Draft && $this->context->personCan($principal, 'write_offs.create', $w->company_id);
    }

    public function submit(Authenticatable $principal, WriteOff $w): bool
    {
        return $this->update($principal, $w);
    }

    public function approve(Authenticatable $principal, WriteOff $w): bool
    {
        return $principal instanceof User
            && $w->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$w->created_by, $w->submitted_by], true)
            && $this->context->allows($principal, 'write_offs.approve', $w->company_id);
    }

    public function return(Authenticatable $principal, WriteOff $w): bool
    {
        return $this->approve($principal, $w);
    }

    public function void(Authenticatable $principal, WriteOff $w): bool
    {
        if (! $principal instanceof User || ! in_array($w->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($w->created_by === $principal->id && $this->context->allows($principal, 'write_offs.create', $w->company_id))
            || $this->context->allows($principal, 'write_offs.approve', $w->company_id);
    }

    public function reverse(Authenticatable $principal, WriteOff $w): bool
    {
        return $principal instanceof User && $w->status === DocumentStatus::Posted && $this->context->allows($principal, 'write_offs.reverse', $w->company_id);
    }
}
