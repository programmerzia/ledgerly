<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use InvalidArgumentException;

/**
 * The only code that sets the app.tenant_id GUC (13 §6).
 *
 * set() applies the GUC to every tenant connection that is already open; connections opened or
 * re-opened later get it from reapply(), called by the ConnectionEstablished listener.
 */
final class TenantContext
{
    private ?string $tenantId = null;

    /** @param list<string> $connections */
    public function __construct(private readonly DatabaseManager $db, private readonly array $connections) {}

    public function set(string $tenantId): void
    {
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $tenantId)) {
            throw new InvalidArgumentException('Tenant id must be a lowercase UUID.');
        }

        $this->tenantId = $tenantId;

        foreach ($this->openConnections() as $connection) {
            $this->apply($connection, $tenantId);
        }
    }

    public function clear(): void
    {
        $this->tenantId = null;

        foreach ($this->openConnections() as $connection) {
            $this->apply($connection, '');
        }
    }

    /**
     * Run $callback inside a tenant context and restore the previous context afterwards.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function run(string $tenantId, Closure $callback): mixed
    {
        $previous = $this->tenantId;
        $this->set($tenantId);

        try {
            return $callback();
        } finally {
            $previous === null ? $this->clear() : $this->set($previous);
        }
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function require(): string
    {
        return $this->tenantId ?? throw new NoTenantContext('No tenant context is set.');
    }

    /** Called when a tenant connection (re)connects, so the GUC survives reconnects. */
    public function reapply(Connection $connection): void
    {
        if (in_array($connection->getName(), $this->connections, true)) {
            $this->apply($connection, $this->tenantId ?? '');
        }
    }

    /** @return list<string> */
    public function connections(): array
    {
        return $this->connections;
    }

    /** @return list<Connection> */
    private function openConnections(): array
    {
        $open = $this->db->getConnections();

        return array_values(array_filter(
            $open,
            fn (Connection $c, string $name) => in_array($name, $this->connections, true),
            ARRAY_FILTER_USE_BOTH,
        ));
    }

    private function apply(Connection $connection, string $value): void
    {
        $connection->select("select set_config('app.tenant_id', ?, false)", [$value]);
    }
}
