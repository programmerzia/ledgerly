<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use RuntimeException;

/** The URL must not be contacted. `reason` is a short stable code, safe to store and show to the owner. */
final class UnsafeWebhookTarget extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
