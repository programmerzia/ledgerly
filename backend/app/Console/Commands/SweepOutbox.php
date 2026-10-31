<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Outbox\OutboxRelay;
use Illuminate\Console\Command;

/** Every 10 s: deliver outbox messages the after-commit kick missed (13 §15). */
final class SweepOutbox extends Command
{
    protected $description = 'Deliver outbox messages that were not relayed after commit';

    protected $signature = 'outbox:sweep {--rounds=5 : Batches to claim before stopping}';

    public function handle(OutboxRelay $relay): int
    {
        $total = 0;
        for ($round = 0; $round < max(1, (int) $this->option('rounds')); $round++) {
            $dispatched = $relay->sweep();
            $total += $dispatched;
            if ($dispatched < OutboxRelay::SWEEP_BATCH) {
                break;
            }
        }
        if ($total > 0) {
            $this->info("Dispatched {$total} message(s).");
        }

        return self::SUCCESS;
    }
}
