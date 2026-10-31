<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use Illuminate\Database\Connection;

final class OutboxWriter
{
    public function __construct(private readonly Clock $clock, private readonly IdGenerator $ids) {}

    /** @return list<string> ids of the written messages */
    public function write(Connection $db, string $tenantId, Outbox $outbox): array
    {
        $ids = [];
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        foreach ($outbox->events() as $event) {
            $id = $this->ids->next();
            $db->insert(
                'INSERT INTO outbox_messages (id, tenant_id, type, payload, occurred_at) VALUES (?, ?, ?, ?::jsonb, ?)',
                [$id, $tenantId, $event->type(), json_encode($event->payload(), JSON_THROW_ON_ERROR), $now],
            );
            $ids[] = $id;
        }

        return $ids;
    }
}
