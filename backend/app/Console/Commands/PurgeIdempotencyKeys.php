<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Hourly: drop idempotency keys older than 24 h through the sysops function (13 §11). */
final class PurgeIdempotencyKeys extends Command
{
    protected $description = 'Delete idempotency keys older than 24 hours';

    protected $signature = 'idempotency:purge';

    public function handle(): int
    {
        $deleted = (int) (DB::selectOne('SELECT sysops.purge_idempotency_keys() AS n')->n ?? 0);
        $this->info("Purged {$deleted} key(s).");

        return self::SUCCESS;
    }
}
