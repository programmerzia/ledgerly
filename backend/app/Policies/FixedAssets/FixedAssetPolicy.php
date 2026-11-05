<?php

declare(strict_types=1);

namespace App\Policies\FixedAssets;

use App\Models\BaseModel;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Asset categories, the register and its reports (13 §7). Reading needs `fixed_assets.view` (tokens: `fixed-assets:read`);
 * changing the register or a category is a person's, with `fixed_assets.manage`. Documents that post (depreciation runs,
 * disposals, impairments, revaluations) have their own policies.
 */
final class FixedAssetPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read');
    }

    public function view(Authenticatable $principal, BaseModel $model): bool
    {
        return $this->context->can($principal, 'fixed_assets.view', 'fixed-assets:read', (string) $model->getAttribute('company_id'));
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'fixed_assets.manage');
    }

    public function update(Authenticatable $principal, BaseModel $model): bool
    {
        return $this->context->personCan($principal, 'fixed_assets.manage', (string) $model->getAttribute('company_id'));
    }
}
