<?php

declare(strict_types=1);

namespace App\Domain\Signing;

use App\Domain\Audit\Jcs;

/**
 * ADR-0004: signature_hash = sha256(document_id ‖ document_content_hash ‖ new_status ‖ signer_id ‖ signed_at),
 * where the content hash is sha256 of the document's canonical JSON at signing time. The hash is
 * stored on the approval record and chained by being part of the buffered audit event.
 */
final class Signature
{
    /** @param array<string, mixed> $documentContent */
    public static function contentHash(array $documentContent): string
    {
        return hash('sha256', Jcs::encode($documentContent));
    }

    public static function hash(string $documentId, string $contentHash, string $newStatus, string $signerId, string $signedAtRfc3339): string
    {
        return hash('sha256', $documentId.$contentHash.$newStatus.$signerId.$signedAtRfc3339);
    }
}
