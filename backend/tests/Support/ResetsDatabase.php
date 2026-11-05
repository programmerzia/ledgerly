<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;

/**
 * Real commits, real deferred triggers: migrate once per process (as the owner role), then
 * truncate every table except reference data before each test. No wrapping transaction, because
 * ledger invariants are enforced at COMMIT.
 */
trait ResetsDatabase
{
    private static bool $databaseMigrated = false;

    private const array KEEP_TABLES = ['migrations', 'currencies', 'chart_templates', 'menu_items'];

    protected function setUpResetsDatabase(): void
    {
        if (! self::$databaseMigrated) {
            $this->artisan('migrate:fresh', ['--database' => 'pgsql_owner']);
            self::$databaseMigrated = true;

            return;
        }

        $owner = DB::connection('pgsql_owner');
        $tables = array_map(
            fn (object $r) => '"'.$r->tablename.'"',
            $owner->select("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> ALL (?::text[])", ['{'.implode(',', self::KEEP_TABLES).'}']),
        );
        $owner->statement('TRUNCATE '.implode(', ', $tables).' RESTART IDENTITY CASCADE');
        DB::purge('pgsql_owner');
    }
}
