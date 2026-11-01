<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

/** What came back from one POST: a status and a capped body snippet, or a short error code when nothing came back. */
final readonly class SendResult
{
    public function __construct(public ?int $status, public ?string $snippet, public ?string $error) {}

    public static function failed(string $error): self
    {
        return new self(null, null, $error);
    }
}
