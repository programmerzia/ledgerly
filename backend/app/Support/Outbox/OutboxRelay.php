<?php

declare(strict_types=1);

namespace App\Support\Outbox;

use App\Contracts\OutboxHandler;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Container\Container;
use Illuminate\Database\DatabaseManager;
use LogicException;
use Throwable;

/**
 * Delivers outbox messages to their handlers (13 §15).
 *
 * Two entry points claim the same way, so they never deliver a message twice at the same time:
 * - `relay()`: the after-commit kick for one transaction's own messages, in its tenant;
 * - `sweep()`: every 10 s, claims stragglers across tenants through `sysops.claim_outbox_batch`
 *   and relays each tenant's share under that tenant's context.
 * A claim lasts 60 s. A message whose handler throws keeps its claim and is retried by a later
 * sweep, up to 20 attempts; `dispatched_at` is set only after every handler succeeded.
 */
final class OutboxRelay
{
    public const int SWEEP_BATCH = 200;

    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly Container $container,
    ) {}

    /**
     * Claims and delivers the given messages of the current tenant.
     *
     * @param  list<string>  $ids
     * @return int messages dispatched
     */
    public function relay(array $ids): int
    {
        if ($ids === []) {
            return 0;
        }
        $this->tenant->require();
        $claimed = $this->db->connection()->select(
            'UPDATE outbox_messages SET claimed_at = now(), attempts = attempts + 1 '
            .'WHERE id = ANY(?::uuid[]) AND dispatched_at IS NULL AND attempts < 20 '
            ."AND (claimed_at IS NULL OR claimed_at < now() - interval '60 seconds') RETURNING id",
            ['{'.implode(',', $ids).'}'],
        );

        return $this->deliver(array_values(array_map(fn (object $r): string => (string) ((array) $r)['id'], $claimed)));
    }

    /** @return int messages dispatched across all tenants */
    public function sweep(int $batch = self::SWEEP_BATCH): int
    {
        if ($this->tenant->id() !== null) {
            throw new LogicException('The outbox sweep must run without a tenant context.');
        }
        $byTenant = [];
        foreach ($this->db->connection()->select('SELECT message_id, tenant_id FROM sysops.claim_outbox_batch(?)', [$batch]) as $row) {
            $byTenant[(string) $row->tenant_id][] = (string) $row->message_id;
        }

        $dispatched = 0;
        foreach ($byTenant as $tenantId => $ids) {
            $dispatched += $this->tenant->run((string) $tenantId, fn (): int => $this->deliver($ids));
        }

        return $dispatched;
    }

    /**
     * Runs handlers for messages this process has claimed.
     *
     * @param  list<string>  $ids
     */
    private function deliver(array $ids): int
    {
        $db = $this->db->connection();
        $dispatched = 0;
        foreach ($ids as $id) {
            $row = $db->selectOne('SELECT id, tenant_id, type, payload, occurred_at, attempts FROM outbox_messages WHERE id = ? AND dispatched_at IS NULL', [$id]);
            if ($row === null) {
                continue;
            }
            $message = new OutboxMessage(
                (string) $row->id, (string) $row->tenant_id, (string) $row->type,
                (array) json_decode((string) $row->payload, true, 512, JSON_THROW_ON_ERROR),
                (string) $row->occurred_at, (int) $row->attempts,
            );

            try {
                foreach ($this->handlersFor($message->type) as $handler) {
                    $handler->handle($message);
                }
            } catch (Throwable $e) {
                report($e);

                continue;
            }

            $db->update('UPDATE outbox_messages SET dispatched_at = now() WHERE id = ?', [$id]);
            $dispatched++;
        }

        return $dispatched;
    }

    /** @return list<OutboxHandler> */
    private function handlersFor(string $type): array
    {
        /** @var array<string, list<class-string<OutboxHandler>>> $map */
        $map = (array) config('outbox.handlers', []);

        return array_map(fn (string $class): OutboxHandler => $this->container->make($class), $map[$type] ?? []);
    }
}
