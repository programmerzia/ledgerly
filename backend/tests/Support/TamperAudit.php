<?php

declare(strict_types=1);

namespace Tests\Support;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;

/**
 * Simulates an attacker with table-owner rights: switches off the append-only trigger and edits
 * audit rows directly, inside one tenant. Only for tests of the chain verifier.
 */
final class TamperAudit
{
    public static function as(string $tenantId, Closure $edit): void
    {
        /** @var Connection $owner */
        $owner = DB::connection('pgsql_owner');
        $owner->statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
        $owner->statement('ALTER TABLE audit_events DISABLE TRIGGER USER');
        try {
            $edit($owner);
        } finally {
            $owner->statement('ALTER TABLE audit_events ENABLE TRIGGER USER');
            $owner->statement("SELECT set_config('app.tenant_id', '', false)");
        }
    }
}
