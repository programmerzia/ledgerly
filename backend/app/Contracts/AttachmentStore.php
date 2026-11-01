<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Models\Files\Attachment;
use App\Support\Files\UploadTarget;
use DateTimeInterface;

/**
 * Where attachment bytes live (13 §17). The local-disk implementation serves dev and tests; an S3/MinIO one
 * presigns direct PUT and GET URLs instead. Keys are opaque: callers never build or parse them except through
 * `quarantineKey()` and `cleanKey()`.
 */
interface AttachmentStore
{
    /** A fresh unguessable key in the quarantine zone, under the tenant and company. */
    public function quarantineKey(string $tenantId, string $companyId): string;

    /** The clean-zone key that belongs to a quarantine key (deterministic, so a retried promotion is harmless). */
    public function cleanKey(string $quarantineKey): string;

    /** Where and how the client uploads the bytes of $attachment (its `path` is the quarantine key). */
    public function uploadTarget(Attachment $attachment, DateTimeInterface $expires): UploadTarget;

    /** A short-lived URL that downloads $attachment as an attachment named after its stored safe filename. */
    public function downloadUrl(Attachment $attachment, DateTimeInterface $expires): string;

    /** Size in bytes, or null when there is no object at the key. */
    public function size(string $key): ?int;

    /** SHA-256 (hex) of the object, streamed; null when absent. */
    public function sha256(string $key): ?string;

    /** @return resource|null a readable stream of the object, or null when absent */
    public function readStream(string $key);

    /** Copies the object to $to, replacing what is there. */
    public function copy(string $from, string $to): void;

    /** Removes the object; absent is fine. */
    public function delete(string $key): void;
}
