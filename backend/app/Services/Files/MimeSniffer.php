<?php

declare(strict_types=1);

namespace App\Services\Files;

use finfo;

/**
 * Decides the real content type from the bytes (libmagic), never from the client's filename or header. libmagic
 * cannot tell an OOXML document from any zip, nor CSV from plain text, so those two cases are accepted only when
 * the client's claim is the matching specific type; everything else is exactly what the bytes say.
 */
final class MimeSniffer
{
    private const string DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    private const string XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    /** @param resource $stream readable, positioned at the start; the position is left at the start */
    public function sniff($stream, string $declared): string
    {
        $head = (string) stream_get_contents($stream, 262144, 0);
        rewind($stream);

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $found = $finfo->buffer($head);
        $found = is_string($found) ? strtolower($found) : 'application/octet-stream';

        if ($found === 'application/zip' && in_array($declared, [self::DOCX, self::XLSX], true) && $this->zipHolds($head, $declared)) {
            return $declared;
        }
        if ($found === 'text/plain' && $declared === 'text/csv') {
            return 'text/csv';
        }

        return $found;
    }

    /** An OOXML file is a zip whose directory names the word/ or xl/ part; check the member names appear in the head. */
    private function zipHolds(string $head, string $declared): bool
    {
        return str_contains($head, $declared === self::DOCX ? 'word/' : 'xl/') || str_contains($head, '[Content_Types].xml');
    }
}
