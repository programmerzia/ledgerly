<?php

declare(strict_types=1);

use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `ledgerly_sysops` SECURITY DEFINER functions (13 §6) in a schema that role owns. The owner role
 * is a member of sysops, so it can create the schema for it and create the functions as it.
 */
return new class extends Migration
{
    public function up(): void
    {
        $db = DB::connection();
        $db->statement('CREATE SCHEMA IF NOT EXISTS sysops AUTHORIZATION ledgerly_sysops');
        $db->statement('REVOKE ALL ON SCHEMA sysops FROM PUBLIC');
        $db->statement('GRANT USAGE ON SCHEMA sysops TO ledgerly_app');
        // sysops reads every table by default privilege; the outbox sweep also writes its claim.
        $db->statement('GRANT UPDATE (claimed_at, attempts) ON outbox_messages TO ledgerly_sysops');

        $db->statement('SET LOCAL ROLE ledgerly_sysops');
        SqlFile::run($db, 'sysops_functions.sql');
        $db->statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP SCHEMA IF EXISTS sysops CASCADE');
        DB::statement('REVOKE UPDATE (claimed_at, attempts) ON outbox_messages FROM ledgerly_sysops');
    }
};
