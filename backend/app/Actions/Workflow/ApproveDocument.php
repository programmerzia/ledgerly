<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Contracts\RoleChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Signing\Signature;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Workflow\DocumentApproved;
use App\Models\Workflow\ApprovalRequest;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeZone;
use Illuminate\Database\Eloquent\Model;

/**
 * Approve one slot of the current step (13 §10). Maker ≠ checker, distinct approvers across
 * steps, the step's role, and a signing grant are all required; the signature is stored on the
 * approval row and chained through the audit event. The final signature posts the document in the
 * same transaction, revalidating, because the period may have closed since submit.
 */
final class ApproveDocument
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Documents $documents,
        private readonly PermissionChecker $permissions,
        private readonly RoleChecker $roles,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, DocumentRef $ref, ?string $comment = null): Postable&Model
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can approve.');
        }
        if (! $actor->hasSigningGrant) {
            throw DomainRuleViolation::single('signature_required', 'Approving needs your signing PIN.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $ref, $comment) {
            $unlocked = $this->documents->find($ref);
            $companyId = $unlocked->documentCompanyId();
            if (! $this->permissions->allows($actor, $this->documents->permission($unlocked, 'approve'), $companyId)) {
                throw DomainRuleViolation::single('forbidden', "You cannot approve {$ref->type}s in this company.");
            }

            $doc = $this->documents->lock($locks, $unlocked, $ref->lockVersion);
            if ($doc->documentStatus() !== DocumentStatus::PendingApproval) {
                throw DomainRuleViolation::single('document_not_pending', "A {$doc->documentStatus()->value} {$ref->type} is not waiting for approval.");
            }
            if (in_array($actor->id, [$doc->documentCreatedBy(), $doc->documentSubmittedBy()], true)) {
                throw DomainRuleViolation::single('self_approval_forbidden', 'You created or submitted this document, so someone else has to approve it.');
            }

            $requests = ApprovalRequest::query()->where('document_type', $ref->type)->where('document_id', $doc->documentId())
                ->orderBy('step')->orderBy('slot')->lockForUpdate()->get();
            if ($requests->contains(fn (ApprovalRequest $r) => $r->signed_by === $actor->id)) {
                throw DomainRuleViolation::single('approver_already_signed', 'You already signed an earlier step of this document.');
            }
            $pending = $requests->where('status', 'pending');
            $slot = $pending->first();
            if ($slot === null) {
                throw DomainRuleViolation::single('document_not_pending', 'Nothing is left to approve on this document.');
            }
            if (! $this->roles->holds($actor, $slot->role, $companyId)) {
                throw DomainRuleViolation::single('approver_role_required', "This step needs a {$slot->role}.");
            }

            $final = $pending->count() === 1;
            $now = $this->clock->now();
            $signature = Signature::hash(
                $doc->documentId(), Signature::contentHash($doc->documentContent()),
                ($final ? DocumentStatus::Posted : DocumentStatus::PendingApproval)->value,
                $actor->id, $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z'),
            );
            $slot->forceFill([
                'status' => 'approved', 'decided_by' => $actor->id, 'decided_at' => $now, 'comment' => $comment,
                'signed_by' => $actor->id, 'signed_at' => $now, 'signature_hash' => $signature,
            ])->save();

            $before = $doc->attributesToArray();
            $doc->forceFill(['lock_version' => $doc->documentLockVersion() + 1, ...($final ? ['approved_by' => $actor->id] : [])])->save();
            $audit->add("{$ref->type}.approved", $doc, before: $before, after: $doc, context: [
                'step' => $slot->step, 'slot' => $slot->slot, 'role' => $slot->role, 'final' => $final, 'signature_hash' => $signature, 'comment' => $comment,
            ]);

            $result = $final ? $this->documents->post($actor, $doc) : $doc;
            $outbox->add(new DocumentApproved($ref->type, $doc->documentId(), $companyId, $result->documentLockVersion(), ['step' => $slot->step, 'final' => $final]));

            return $result;
        });
    }
}
