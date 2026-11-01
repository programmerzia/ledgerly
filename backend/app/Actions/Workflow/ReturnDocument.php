<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Workflow\DocumentReturned;
use App\Models\Workflow\ApprovalRequest;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\Eloquent\Model;

/** An approver sends the document back to draft with a comment (13 §10); its open steps are cancelled. */
final class ReturnDocument
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Documents $documents,
        private readonly PermissionChecker $permissions,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, ReturnDocumentInput $in): Postable&Model
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can return a document.');
        }
        if (trim($in->comment) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say what needs to change before returning the document.');
        }
        $ref = $in->document;

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $ref, $in) {
            $unlocked = $this->documents->find($ref);
            $companyId = $unlocked->documentCompanyId();
            if (! $this->permissions->allows($actor, $this->documents->permission($unlocked, 'return'), $companyId)) {
                throw DomainRuleViolation::single('forbidden', "You cannot review {$ref->type}s in this company.");
            }
            $doc = $this->documents->lock($locks, $unlocked, $ref->lockVersion);
            if ($doc->documentStatus() !== DocumentStatus::PendingApproval) {
                throw DomainRuleViolation::single('document_not_pending', "A {$doc->documentStatus()->value} {$ref->type} cannot be returned.");
            }

            $now = $this->clock->now();
            $first = true;
            foreach (ApprovalRequest::query()->where('document_type', $ref->type)->where('document_id', $doc->documentId())
                ->where('status', 'pending')->orderBy('step')->orderBy('slot')->lockForUpdate()->get() as $request) {
                $request->forceFill($first
                    ? ['status' => 'returned', 'decided_by' => $actor->id, 'decided_at' => $now, 'comment' => $in->comment]
                    : ['status' => 'cancelled'])->save();
                $first = false;
            }

            $before = $doc->attributesToArray();
            $doc->forceFill(['status' => DocumentStatus::Draft->value, 'lock_version' => $doc->documentLockVersion() + 1])->save();
            $audit->add("{$ref->type}.returned", $doc, before: $before, after: $doc, context: ['comment' => $in->comment]);
            $outbox->add(new DocumentReturned($ref->type, $doc->documentId(), $companyId, $doc->documentLockVersion(), ['comment' => $in->comment]));

            return $doc;
        });
    }
}
