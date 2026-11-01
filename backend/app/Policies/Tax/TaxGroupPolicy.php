<?php

declare(strict_types=1);

namespace App\Policies\Tax;

use App\Models\Tax\TaxGroup;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Tax groups (13 §7). Tokens may read (`tax:read`); changing them is for people with `tax.manage`. */
final class TaxGroupPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'tax.view', 'tax:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'tax.manage');
    }

    public function update(Authenticatable $principal, TaxGroup $group): bool
    {
        return $this->context->personCan($principal, 'tax.manage', $group->company_id);
    }

    public function deactivate(Authenticatable $principal, TaxGroup $group): bool
    {
        return $group->is_active && $this->update($principal, $group);
    }
}
