<?php

declare(strict_types=1);

namespace App\Support\Idempotency;

/** Who a key belongs to (13 §11): keys never collide across tenants or actors. */
final readonly class IdempotencyScope
{
    public function __construct(
        public string $tenantId,
        public string $actorType,
        public string $actorId,
        public string $key,
    ) {}
}
