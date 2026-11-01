<?php

declare(strict_types=1);

namespace App\Actions\Files;

use App\Contracts\AttachmentStore;
use App\Contracts\Clock;
use App\Contracts\VirusScanner;
use App\Domain\Files\ScanStatus;
use App\Models\Files\Attachment;
use App\Models\Platform\User;
use App\Notifications\AttachmentInfectedNotification;
use App\Services\Files\MimeSniffer;
use App\Support\Actor;
use App\Support\Files\ScannerRejected;
use App\Support\Files\ScannerUnavailable;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use LogicException;

/**
 * The scan pipeline (13 §17), run by the `ScanAttachment` job as the system actor: re-verify the bytes against the
 * recorded checksum, sniff the real content type, ask the scanner, then promote the file from quarantine to the clean
 * zone, or delete it. A scanner that cannot answer leaves the file pending (the exception goes to the job, which
 * retries with backoff). The row of a deleted file stays, with its status, as the record.
 */
final class ScanAttachmentFile
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
        private readonly AttachmentStore $store,
        private readonly VirusScanner $scanner,
        private readonly MimeSniffer $sniffer,
    ) {}

    /** @throws ScannerUnavailable when the scanner cannot be used: the file stays pending */
    public function handle(string $tenantId, string $companyId, string $attachmentId): void
    {
        $actor = Actor::system($tenantId, $companyId);
        $attachment = Attachment::query()->where('company_id', $companyId)->whereKey($attachmentId)->first();
        if ($attachment === null || $attachment->scan_status !== ScanStatus::Pending || $attachment->completed_at === null) {
            return; // gone, already judged, or the bytes are not verified yet
        }

        $local = $this->localCopy($attachment->path);
        if ($local === null) {
            $this->finish($actor, $attachment->id, ScanStatus::Error, 'object_missing');

            return;
        }

        try {
            if (! hash_equals($attachment->sha256, $this->hash($local))) {
                $this->finish($actor, $attachment->id, ScanStatus::Error, 'checksum_changed');

                return;
            }

            $mime = $this->sniffer->sniff($local, $attachment->mime);
            if (! in_array($mime, (array) config('attachments.mimes'), true)) {
                $this->finish($actor, $attachment->id, ScanStatus::Error, 'type_not_allowed:'.mb_substr($mime, 0, 100));

                return;
            }

            try {
                $result = $this->scanner->scan($local);
            } catch (ScannerUnavailable $e) {
                $this->noteAttempt($actor, $attachment->id);
                throw $e;
            } catch (ScannerRejected $e) {
                $this->finish($actor, $attachment->id, ScanStatus::Error, 'scanner_refused:'.mb_substr($e->getMessage(), 0, 150));

                return;
            }
        } finally {
            fclose($local);
        }

        $result->clean
            ? $this->finish($actor, $attachment->id, ScanStatus::Clean, null, $mime)
            : $this->finish($actor, $attachment->id, ScanStatus::Infected, $result->signature);
    }

    /** @return resource|null the object copied to a temporary stream, at the start */
    private function localCopy(string $key)
    {
        $source = $this->store->readStream($key);
        if ($source === null) {
            return null;
        }
        $tmp = tmpfile();
        if ($tmp === false) {
            throw new LogicException('No temporary file.');
        }
        stream_copy_to_stream($source, $tmp);
        fclose($source);
        rewind($tmp);

        return $tmp;
    }

    /** @param resource $stream */
    private function hash($stream): string
    {
        $ctx = hash_init('sha256');
        hash_update_stream($ctx, $stream);
        rewind($stream);

        return hash_final($ctx);
    }

    private function noteAttempt(Actor $actor, string $id): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($id): void {
            $attachment = $locks->document(Attachment::query()->findOrFail($id));
            $attachment->forceFill(['scan_attempts' => $attachment->scan_attempts + 1, 'scan_checked_at' => $this->clock->now()])->save();
        });
    }

    private function finish(Actor $actor, string $id, ScanStatus $status, ?string $detail, ?string $mime = null): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($id, $status, $detail, $mime): void {
            $attachment = $locks->document(Attachment::query()->findOrFail($id));
            if ($attachment->scan_status !== ScanStatus::Pending) {
                return; // another worker judged it first
            }

            $before = $attachment->attributesToArray();
            $quarantined = $attachment->path;
            $now = $this->clock->now();
            $changes = [
                'scan_status' => $status, 'scan_detail' => $detail, 'scanned_at' => $now, 'scan_checked_at' => $now,
                'scan_attempts' => $attachment->scan_attempts + 1, 'lock_version' => $attachment->lock_version + 1,
            ];

            if ($status === ScanStatus::Clean) {
                $clean = $this->store->cleanKey($quarantined);
                $this->store->copy($quarantined, $clean); // deterministic target: a retry after a failed commit is harmless
                $changes['path'] = $clean;
                $changes['mime'] = $mime ?? $attachment->mime;
                $this->uow->afterCommit(fn () => $this->store->delete($quarantined));
            } else {
                $this->uow->afterCommit(fn () => $this->store->delete($quarantined));
            }

            $attachment->forceFill($changes)->save();
            $attachment->refresh();
            $audit->add(
                match ($status) {
                    ScanStatus::Clean => 'attachment.scan_clean',
                    ScanStatus::Infected => 'attachment.infected',
                    default => 'attachment.scan_failed',
                },
                $attachment, before: $before, after: $attachment, context: $detail === null ? [] : ['detail' => $detail],
            );

            if ($status === ScanStatus::Infected && $attachment->uploaded_by !== null) {
                $uploader = $attachment->uploaded_by;
                $name = $attachment->original_name;
                $this->uow->afterCommit(function () use ($uploader, $name, $detail): void {
                    // An API client has no mailbox; its trail is the audit event.
                    User::query()->find($uploader)?->notify(new AttachmentInfectedNotification($name, (string) $detail));
                });
            }
        });
    }
}
