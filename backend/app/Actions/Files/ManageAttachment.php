<?php

declare(strict_types=1);

namespace App\Actions\Files;

use App\Actions\Files\Inputs\UploadIntentInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\AttachmentStore;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Files\SafeFilename;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\BaseModel;
use App\Models\Files\Attachment;
use App\Support\Actor;
use App\Support\Files\AttachableTypes;
use App\Support\Files\ScanQueue;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The user-facing half of attachments (13 §17): ask for an upload (creates the pending row and its quarantine key),
 * complete it (verifies size and SHA-256, then queues the scan) and delete. Attaching needs the parent's view and
 * create/manage permission. Evidence rule (02 §5): files can be added to a posted document, flagged and audited,
 * but not removed.
 */
final class ManageAttachment
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly SetupGuard $guard,
        private readonly AttachmentStore $store,
    ) {}

    public function requestUpload(Actor $actor, UploadIntentInput $in): Attachment
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $parent = $this->parent($in->attachableType, $in->companyId, $in->attachableId);
            $this->requireWrite($actor, $in->attachableType, $parent, $in->companyId);

            $this->validateFile($in);
            $posted = AttachableTypes::isPosted($parent);

            $attachment = new Attachment;
            $attachment->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                'attachable_type' => $in->attachableType, 'attachable_id' => $in->attachableId,
                'disk' => (string) config('attachments.disk'),
                'path' => $this->store->quarantineKey($actor->tenantId, $in->companyId),
                'original_name' => SafeFilename::clean($in->filename), 'mime' => $in->mime,
                'size' => $in->size, 'sha256' => strtolower($in->sha256),
                'scan_status' => 'pending', 'added_after_posting' => $posted, 'uploaded_by' => $actor->id,
            ])->save();
            $attachment->refresh();
            $audit->add('attachment.upload_requested', $attachment, after: $attachment, context: ['added_after_posting' => $posted]);

            return $attachment;
        });
    }

    public function complete(Actor $actor, string $attachmentId): Attachment
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $attachmentId) {
            $attachment = $locks->document(Attachment::query()->findOrFail($attachmentId));
            $this->requireWrite($actor, $attachment->attachable_type, $this->parent($attachment->attachable_type, $attachment->company_id, $attachment->attachable_id), $attachment->company_id);

            if ($attachment->completed_at !== null) {
                return $attachment; // completing twice is harmless
            }

            $size = $this->store->size($attachment->path);
            if ($size === null) {
                throw DomainRuleViolation::single('attachment_not_uploaded', 'The file has not been uploaded yet.');
            }
            if ($size !== $attachment->size || $this->store->sha256($attachment->path) !== $attachment->sha256) {
                // The bytes are not what was announced: keep nothing of them.
                $this->store->delete($attachment->path);
                throw DomainRuleViolation::single('attachment_mismatch', 'The uploaded file does not match the announced size and checksum. Upload it again.');
            }

            $attachment->forceFill(['completed_at' => $this->clock->now(), 'lock_version' => $attachment->lock_version + 1])->save();
            $attachment->refresh();
            $audit->add('attachment.uploaded', $attachment, after: $attachment, context: ['added_after_posting' => $attachment->added_after_posting]);
            $this->uow->afterCommit(fn () => ScanQueue::push($attachment->tenant_id, $attachment->company_id, $attachment->id));

            return $attachment;
        });
    }

    public function delete(Actor $actor, string $attachmentId): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $attachmentId) {
            $attachment = $locks->document(Attachment::query()->findOrFail($attachmentId));
            $parent = $this->parent($attachment->attachable_type, $attachment->company_id, $attachment->attachable_id);
            $this->requireWrite($actor, $attachment->attachable_type, $parent, $attachment->company_id);

            if (AttachableTypes::isPosted($parent)) {
                throw DomainRuleViolation::single('attachment_immutable', 'Files on a posted document are evidence and cannot be removed.');
            }

            $before = $attachment->attributesToArray();
            $path = $attachment->path;
            $attachment->delete();
            $audit->add('attachment.deleted', $attachment, before: $before);
            $this->uow->afterCommit(fn () => $this->store->delete($path));
        });
    }

    private function parent(string $type, string $companyId, string $id): BaseModel
    {
        return AttachableTypes::find($type, $companyId, $id)
            ?? throw DomainRuleViolation::single('attachable_not_found', 'The document or contact to attach to does not exist in this company.');
    }

    /** View and write permission on the parent's module; API clients are let through on their token ability (route policy). */
    private function requireWrite(Actor $actor, string $type, BaseModel $parent, string $companyId): void
    {
        $this->guard->require($actor, AttachableTypes::viewPermission($type, $parent), $companyId, tokens: true);
        $this->guard->require($actor, AttachableTypes::writePermission($type, $parent), $companyId, tokens: true);
    }

    private function validateFile(UploadIntentInput $in): void
    {
        if ($in->size < 1 || $in->size > (int) config('attachments.max_bytes')) {
            throw DomainRuleViolation::single('attachment_too_large', 'The file is empty or larger than the allowed size.');
        }
        if (! in_array($in->mime, (array) config('attachments.mimes'), true)) {
            throw DomainRuleViolation::single('attachment_type_not_allowed', 'This file type is not allowed.');
        }
    }
}
