<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Support\Outbox\OutboxMessage;

/**
 * Consumes one outbox message type (13 §15). Delivery is at least once and in no guaranteed order,
 * so a handler must be idempotent by `$message->id` and tolerate stale messages (compare
 * `occurred_at` or the subject's version). It runs inside the message's tenant context.
 */
interface OutboxHandler
{
    public function handle(OutboxMessage $message): void;
}
