<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Workflow\Inputs\ApprovalWorkflowInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Role;
use App\Models\Workflow\ApprovalWorkflow;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Approval workflows (`settings.manage`, people only). A submit snapshots the matching workflow's steps, so
 * editing or deactivating a workflow never changes a document already waiting for approval (13 §10).
 */
final class ManageApprovalWorkflow
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, ApprovalWorkflowInput $in): ApprovalWorkflow
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'settings.manage', $in->companyId);
            $this->assertValid($in);

            $workflow = new ApprovalWorkflow;
            $workflow->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                ...$this->columns($in),
            ])->save();
            $workflow->refresh();
            $audit->add('approval_workflow.created', $workflow, after: $workflow);

            return $workflow;
        });
    }

    public function update(Actor $actor, string $workflowId, int $version, ApprovalWorkflowInput $in): ApprovalWorkflow
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $workflowId, $version, $in) {
            $workflow = $locks->document(ApprovalWorkflow::query()->findOrFail($workflowId), $version);
            $this->guard->require($actor, 'settings.manage', $workflow->company_id);
            $this->assertValid($in);

            $before = $workflow->attributesToArray();
            $workflow->forceFill([...$this->columns($in), 'lock_version' => $workflow->lock_version + 1])->save();
            $workflow->refresh();
            $audit->add('approval_workflow.updated', $workflow, before: $before, after: $workflow);

            return $workflow;
        });
    }

    public function deactivate(Actor $actor, string $workflowId, int $version): ApprovalWorkflow
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $workflowId, $version) {
            $workflow = $locks->document(ApprovalWorkflow::query()->findOrFail($workflowId), $version);
            $this->guard->require($actor, 'settings.manage', $workflow->company_id);
            if (! $workflow->is_active) {
                throw DomainRuleViolation::single('workflow_already_inactive', 'The workflow is already inactive.');
            }

            $before = $workflow->attributesToArray();
            $workflow->forceFill(['is_active' => false, 'lock_version' => $workflow->lock_version + 1])->save();
            $workflow->refresh();
            $audit->add('approval_workflow.deactivated', $workflow, before: $before, after: $workflow);

            return $workflow;
        });
    }

    /** @return array<string, mixed> */
    private function columns(ApprovalWorkflowInput $in): array
    {
        return [
            'document_type' => $in->documentType, 'name' => $in->name, 'source' => $in->source,
            'min_amount' => $in->minAmount, 'max_amount' => $in->maxAmount, 'steps' => $in->steps,
        ];
    }

    private function assertValid(ApprovalWorkflowInput $in): void
    {
        if (! in_array($in->documentType, Documents::TYPES, true)) {
            throw DomainRuleViolation::single('document_type_unknown', "Unknown document type {$in->documentType}.");
        }
        if ($in->maxAmount !== null && $in->maxAmount <= $in->minAmount) {
            throw DomainRuleViolation::single('workflow_range_invalid', 'The maximum amount must be above the minimum.');
        }
        if ($in->steps === []) {
            throw DomainRuleViolation::single('workflow_steps_required', 'A workflow needs at least one step.');
        }
        $roles = Role::query()->where('company_id', $in->companyId)->pluck('name')->all();
        foreach ($in->steps as $i => $step) {
            if (! in_array($step['role'], $roles, true) || $step['count'] < 1) {
                throw DomainRuleViolation::single('workflow_step_invalid', 'Step '.($i + 1).' needs one of this company\'s roles and at least one approver.');
            }
        }
    }
}
