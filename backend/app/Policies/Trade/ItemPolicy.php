<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Models\Trade\Item;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Products and services (13 §7). Tokens: `items:read` and `items:write`. */
final class ItemPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'items.view', 'items:read');
    }

    public function view(Authenticatable $principal, Item $item): bool
    {
        return $this->context->can($principal, 'items.view', 'items:read', $item->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'items.manage', 'items:write');
    }

    public function update(Authenticatable $principal, Item $item): bool
    {
        return $this->context->can($principal, 'items.manage', 'items:write', $item->company_id);
    }

    public function deactivate(Authenticatable $principal, Item $item): bool
    {
        return $item->is_active && $this->update($principal, $item);
    }
}
