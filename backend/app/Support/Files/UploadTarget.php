<?php

declare(strict_types=1);

namespace App\Support\Files;

use DateTimeInterface;

/** A presigned upload: PUT the raw bytes to `url` with `headers` before `expiresAt`. */
final readonly class UploadTarget
{
    /** @param array<string, string> $headers */
    public function __construct(
        public string $url,
        public string $method,
        public array $headers,
        public DateTimeInterface $expiresAt,
    ) {}
}
