<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\OutboxHandler;
use App\Support\Outbox\OutboxMessage;
use App\Support\Tenancy\TenantContext;
use RuntimeException;

/** Test handler: records deliveries (with the tenant context seen) and can be told to fail. */
final class RecordingOutboxHandler implements OutboxHandler
{
    /** @var list<array{id: string, type: string, tenant: string|null}> */
    public static array $delivered = [];

    public static bool $fail = false;

    public function handle(OutboxMessage $message): void
    {
        if (self::$fail) {
            throw new RuntimeException('handler down');
        }
        self::$delivered[] = ['id' => $message->id, 'type' => $message->type, 'tenant' => app(TenantContext::class)->id()];
    }
}
