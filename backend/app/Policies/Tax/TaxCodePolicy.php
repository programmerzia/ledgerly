<?php

declare(strict_types=1);

namespace App\Policies\Tax;

use App\Models\Tax\TaxCode;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Tax set-up (13 §7). Tokens may read (`tax:read`); changing it is for people with `tax.manage`. */
final class TaxCodePolicy
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

    public function update(Authenticatable $principal, TaxCode $code): bool
    {
        return $this->context->personCan($principal, 'tax.manage', $code->company_id);
    }

    public function deactivate(Authenticatable $principal, TaxCode $code): bool
    {
        return $code->is_active && $this->update($principal, $code);
    }
}
