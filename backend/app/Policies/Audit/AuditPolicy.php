<?php

declare(strict_types=1);

namespace App\Policies\Audit;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** The audit log: `audit.view` to read, `audit.verify` to recompute the chain (Owner, Finance Manager reads, Auditor both). People only. */
final class AuditPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'audit.view');
    }

    public function verify(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'audit.verify');
    }
}
