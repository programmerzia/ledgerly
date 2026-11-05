<?php

declare(strict_types=1);

namespace App\Policies\FixedAssets;

use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Depreciation runs: viewing needs `fixed_assets.view` (tokens: `fixed-assets:read`), drafting and submitting
 * `fixed_assets.run_depreciation`, approving, returning and voiding `fixed_assets.approve` (maker ≠ checker), reversing
 * `fixed_assets.reverse`. Posting is always a person.
 */
final class DepreciationRunPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read');
    }

    public function view(Authenticatable $principal, DepreciationRun $run): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read', $run->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'fixed_assets.run_depreciation');
    }

    public function submit(Authenticatable $principal, DepreciationRun $run): bool
    {
        return $run->status === DocumentStatus::Draft && $this->context->personCan($principal, 'fixed_assets.run_depreciation', $run->company_id);
    }

    public function approve(Authenticatable $principal, DepreciationRun $run): bool
    {
        return $principal instanceof User
            && $run->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$run->created_by, $run->submitted_by], true)
            && $this->context->allows($principal, 'fixed_assets.approve', $run->company_id);
    }

    public function return(Authenticatable $principal, DepreciationRun $run): bool
    {
        return $this->approve($principal, $run);
    }

    public function void(Authenticatable $principal, DepreciationRun $run): bool
    {
        if (! $principal instanceof User || ! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($run->created_by === $principal->id && $this->context->allows($principal, 'fixed_assets.run_depreciation', $run->company_id))
            || $this->context->allows($principal, 'fixed_assets.approve', $run->company_id);
    }

    public function reverse(Authenticatable $principal, DepreciationRun $run): bool
    {
        return $run->status === DocumentStatus::Posted && $this->context->personCan($principal, 'fixed_assets.reverse', $run->company_id);
    }
}
