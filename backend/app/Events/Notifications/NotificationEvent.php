<?php

declare(strict_types=1);

namespace App\Events\Notifications;

use App\Contracts\OutboxEvent;

/** Events raised by jobs (outside a UnitOfWork) that only the bell cares about: a queued export is ready, a send failed. */
final readonly class NotificationEvent implements OutboxEvent
{
    public const string REPORT_READY = 'report.ready';

    public const string SEND_FAILED = 'document.send_failed';

    /** @param array<string, mixed> $payload */
    public function __construct(private string $type, private array $payload) {}

    public function type(): string
    {
        return $this->type;
    }

    public function payload(): array
    {
        return $this->payload;
    }
}
