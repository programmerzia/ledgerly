<?php

declare(strict_types=1);

namespace App\Policies\Workflow;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** The approvals inbox: people who may approve documents. The inbox query narrows it to what they could sign. */
final class ApprovalRequestPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'journals.approve');
    }
}
