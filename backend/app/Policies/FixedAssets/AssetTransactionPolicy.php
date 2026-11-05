<?php

declare(strict_types=1);

namespace App\Policies\FixedAssets;

use App\Domain\FixedAssets\AssetPermissions;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Disposals, impairments and revaluations: viewing needs `fixed_assets.view` (tokens: `fixed-assets:read`); drafting and submitting
 * `fixed_assets.dispose` (disposal) or `fixed_assets.revalue` (the rest); approving, returning and voiding `fixed_assets.approve`
 * (maker ≠ checker); reversing `fixed_assets.reverse`. Posting is always a person.
 */
final class AssetTransactionPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read');
    }

    public function view(Authenticatable $principal, AssetTransaction $tx): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read', $tx->company_id);
    }

    /** Either permission opens the screen; the Action checks the one the kind needs. */
    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'fixed_assets.dispose') || $this->context->personCan($principal, 'fixed_assets.revalue');
    }

    public function submit(Authenticatable $principal, AssetTransaction $tx): bool
    {
        return $tx->status === DocumentStatus::Draft && $this->context->personCan($principal, AssetPermissions::FOR_KIND[$tx->kind], $tx->company_id);
    }

    public function approve(Authenticatable $principal, AssetTransaction $tx): bool
    {
        return $principal instanceof User
            && $tx->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$tx->created_by, $tx->submitted_by], true)
            && $this->context->allows($principal, 'fixed_assets.approve', $tx->company_id);
    }

    public function return(Authenticatable $principal, AssetTransaction $tx): bool
    {
        return $this->approve($principal, $tx);
    }

    public function void(Authenticatable $principal, AssetTransaction $tx): bool
    {
        if (! $principal instanceof User || ! in_array($tx->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }

        return ($tx->created_by === $principal->id && $this->context->allows($principal, AssetPermissions::FOR_KIND[$tx->kind], $tx->company_id))
            || $this->context->allows($principal, 'fixed_assets.approve', $tx->company_id);
    }

    public function reverse(Authenticatable $principal, AssetTransaction $tx): bool
    {
        return $tx->status === DocumentStatus::Posted && $this->context->personCan($principal, 'fixed_assets.reverse', $tx->company_id);
    }
}
