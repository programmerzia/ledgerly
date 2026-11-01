<?php

declare(strict_types=1);

namespace App\Policies\Workflow;

use App\Models\Workflow\ApprovalWorkflow;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Approval workflows are company settings (`settings.manage`): people only, tokens have no ability for them. */
final class ApprovalWorkflowPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'settings.manage');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->viewAny($principal);
    }

    public function update(Authenticatable $principal, ApprovalWorkflow $workflow): bool
    {
        return $this->context->personCan($principal, 'settings.manage', $workflow->company_id);
    }

    public function deactivate(Authenticatable $principal, ApprovalWorkflow $workflow): bool
    {
        return $workflow->is_active && $this->update($principal, $workflow);
    }
}
