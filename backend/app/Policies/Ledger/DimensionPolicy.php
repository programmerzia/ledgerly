<?php

declare(strict_types=1);

namespace App\Policies\Ledger;

use App\Models\Ledger\Dimension;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Dimensions and their values (13 §7); values are authorized through their dimension. Tokens: `dimensions:read|write`. */
final class DimensionPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'dimensions.view', 'dimensions:read');
    }

    public function view(Authenticatable $principal, Dimension $dimension): bool
    {
        return $this->context->can($principal, 'dimensions.view', 'dimensions:read', $dimension->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'dimensions.manage', 'dimensions:write');
    }

    public function update(Authenticatable $principal, Dimension $dimension): bool
    {
        return $this->context->can($principal, 'dimensions.manage', 'dimensions:write', $dimension->company_id);
    }

    public function deactivate(Authenticatable $principal, Dimension $dimension): bool
    {
        return $dimension->is_active && $this->update($principal, $dimension);
    }
}
