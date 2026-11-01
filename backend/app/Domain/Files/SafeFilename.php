<?php

declare(strict_types=1);

namespace App\Domain\Files;

/**
 * Turns whatever the client called a file into a name that is safe to store and to put in a Content-Disposition
 * header: no directories (path traversal), no control characters or line breaks (header injection), no characters
 * that are special to shells, URLs or header parameters, no leading dot, bounded length with the extension kept.
 */
final class SafeFilename
{
    public const int MAX_LENGTH = 120;

    public const string FALLBACK = 'file';

    public static function clean(string $name): string
    {
        // Only the last path segment counts, for / and \ alike (and a NUL cuts the name like it would in C).
        $name = explode("\0", $name)[0];
        $parts = preg_split('#[\\\\/]+#', $name) ?: [$name];
        $name = (string) end($parts);

        // Normalise away anything that is not a letter, number, space or . _ - ( ) — including all control and
        // format characters (CR, LF, bidi overrides) — then collapse the gaps.
        $name = (string) preg_replace('/[^\p{L}\p{N} ._()\-]+/u', '_', $name);
        $name = (string) preg_replace('/[ _]{2,}/u', '_', $name);
        $name = trim($name, " .\t_-");
        // "a..b" is harmless as a name but never leave a run of dots that reads as traversal.
        $name = (string) preg_replace('/\.{2,}/', '.', $name);

        if ($name === '' || ! preg_match('/[\p{L}\p{N}]/u', $name)) {
            return self::FALLBACK;
        }

        if (mb_strlen($name) > self::MAX_LENGTH) {
            $dot = mb_strrpos($name, '.');
            $extension = $dot !== false && mb_strlen($name) - $dot <= 12 ? mb_substr($name, $dot) : '';
            $name = mb_substr($name, 0, self::MAX_LENGTH - mb_strlen($extension)).$extension;
        }

        return $name;
    }
}
