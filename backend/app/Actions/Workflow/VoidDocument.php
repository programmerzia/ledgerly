<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Workflow\DocumentVoided;
use App\Models\Workflow\ApprovalRequest;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\Eloquent\Model;

/**
 * Void a draft or a document waiting for approval (13 §10). Nothing posted is ever voided; posted
 * documents are reversed. The creator may void their own; an approver may void any.
 */
final class VoidDocument
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Documents $documents,
        private readonly PermissionChecker $permissions,
    ) {}

    public function handle(Actor $actor, VoidDocumentInput $in): Postable&Model
    {
        $ref = $in->document;

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $ref, $in) {
            $unlocked = $this->documents->find($ref);
            $companyId = $unlocked->documentCompanyId();
            $own = $actor->id !== null && $unlocked->documentCreatedBy() === $actor->id;
            if (! $own && ! $this->permissions->allows($actor, "{$ref->type}s.approve", $companyId)) {
                throw DomainRuleViolation::single('forbidden', 'Only the creator or an approver can void this document.');
            }

            $doc = $this->documents->lock($locks, $unlocked, $ref->lockVersion);
            if (! $doc->documentStatus()->canBecome(DocumentStatus::Void)) {
                throw DomainRuleViolation::single('document_not_voidable', "A {$doc->documentStatus()->value} {$ref->type} cannot be voided; reverse it instead.");
            }

            ApprovalRequest::query()->where('document_type', $ref->type)->where('document_id', $doc->documentId())
                ->where('status', 'pending')->update(['status' => 'cancelled']);

            $before = $doc->attributesToArray();
            $doc->forceFill(['status' => DocumentStatus::Void->value, 'lock_version' => $doc->documentLockVersion() + 1])->save();
            $audit->add("{$ref->type}.voided", $doc, before: $before, after: $doc, context: ['reason' => $in->reason]);
            $outbox->add(new DocumentVoided($ref->type, $doc->documentId(), $companyId, $doc->documentLockVersion(), ['reason' => $in->reason]));

            return $doc;
        });
    }
}
