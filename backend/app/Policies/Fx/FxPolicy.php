<?php

declare(strict_types=1);

namespace App\Policies\Fx;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Exchange rates and FX revaluations (13 §7). Tokens: `fx:read` reads rates and runs; `fx:write` may enter manual
 * rates. Fetching provider rates and running a revaluation (which posts) are a person's, with `fx.manage`.
 */
final class FxPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'fx.view', 'fx:read');
    }

    /** A manual rate. */
    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'fx.manage', 'fx:write');
    }

    public function fetch(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'fx.manage');
    }

    public function run(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'fx.manage');
    }
}
