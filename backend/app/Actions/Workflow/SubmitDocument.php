<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Signing\Signature;
use App\Domain\Workflow\DocumentSource;
use App\Domain\Workflow\DocumentStatus;
use App\Domain\Workflow\WorkflowDefinition;
use App\Domain\Workflow\WorkflowResolver;
use App\Events\Workflow\DocumentSubmitted;
use App\Models\Workflow\ApprovalRequest;
use App\Models\Workflow\ApprovalWorkflow;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeZone;
use Illuminate\Database\Eloquent\Model;

/**
 * Submit (13 §10): validate early, pick the workflow by (type, source, amount) and snapshot its
 * steps. With no workflow the document posts now: a person needs a signing grant (ADR-0004), an
 * API client posts on its token's evidence.
 */
final class SubmitDocument
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Documents $documents,
        private readonly PermissionChecker $permissions,
        private readonly Clock $clock,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, DocumentRef $ref): Postable&Model
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $ref) {
            $unlocked = $this->documents->find($ref);
            $companyId = $unlocked->documentCompanyId();
            if (! $actor->isApiClient() && ! $this->permissions->allows($actor, "{$ref->type}s.submit", $companyId)) {
                throw DomainRuleViolation::single('forbidden', "You cannot submit {$ref->type}s in this company.");
            }

            $doc = $this->documents->lock($locks, $unlocked, $ref->lockVersion);
            if ($doc->documentStatus() !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_submittable', "A {$doc->documentStatus()->value} {$ref->type} cannot be submitted.");
            }

            // Fail early: everything that would stop the posting is reported now, not at approval.
            $violations = $this->documents->violations($actor, $doc);
            if ($violations !== []) {
                throw PostingRejected::because($violations);
            }

            $source = $actor->isApiClient() ? DocumentSource::Api : DocumentSource::User;
            $workflow = WorkflowResolver::resolve($this->activeWorkflows($companyId, $ref->type), $ref->type, $source, $doc->documentAmount());
            $now = $this->clock->now();

            if ($workflow === null) {
                if (! $actor->isApiClient() && ! $actor->hasSigningGrant) {
                    throw DomainRuleViolation::single('signature_required', 'Posting needs your signing PIN.');
                }
                $before = $doc->attributesToArray();
                $doc->forceFill(['submitted_by' => $actor->id, 'lock_version' => $doc->documentLockVersion() + 1])->save();
                $signature = $actor->isApiClient() ? null : Signature::hash(
                    $doc->documentId(), Signature::contentHash($doc->documentContent()), DocumentStatus::Posted->value,
                    (string) $actor->id, $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z'),
                );
                $audit->add("{$ref->type}.submitted", $doc, before: $before, after: $doc, context: ['workflow_id' => null, 'posted_directly' => true, 'signature_hash' => $signature]);
                $posted = $this->documents->post($actor, $doc);
                $outbox->add(new DocumentSubmitted($ref->type, $doc->documentId(), $companyId, $posted->documentLockVersion(), ['posted_directly' => true]));

                return $posted;
            }

            $steps = [];
            foreach ($workflow->steps as $i => $step) {
                for ($slot = 1; $slot <= $step->count; $slot++) {
                    (new ApprovalRequest)->forceFill([
                        'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId,
                        'document_type' => $ref->type, 'document_id' => $doc->documentId(), 'workflow_id' => $workflow->id,
                        'step' => $i + 1, 'slot' => $slot, 'role' => $step->role, 'status' => 'pending',
                        'requested_by' => $actor->id, 'requested_at' => $now,
                    ])->save();
                }
                $steps[] = ['role' => $step->role, 'count' => $step->count];
            }
            $before = $doc->attributesToArray();
            $doc->forceFill(['status' => DocumentStatus::PendingApproval->value, 'submitted_by' => $actor->id, 'lock_version' => $doc->documentLockVersion() + 1])->save();
            $audit->add("{$ref->type}.submitted", $doc, before: $before, after: $doc, context: ['workflow_id' => $workflow->id, 'steps' => $steps]);
            $outbox->add(new DocumentSubmitted($ref->type, $doc->documentId(), $companyId, $doc->documentLockVersion(), ['workflow_id' => $workflow->id]));

            return $doc;
        });
    }

    /** @return list<WorkflowDefinition> */
    private function activeWorkflows(string $companyId, string $type): array
    {
        return array_values(ApprovalWorkflow::query()->where('company_id', $companyId)->where('document_type', $type)->where('is_active', true)
            ->get()->map(fn (ApprovalWorkflow $w) => $w->toDefinition())->all());
    }
}
