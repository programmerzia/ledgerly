<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Workflow\ApprovalWorkflow;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Runs Action calls in real, separate PHP processes (tests/Concurrency/bin/race-worker.php) that
 * are released together by a barrier, so the transactions genuinely overlap.
 */
final class Race
{
    /**
     * @param  list<list<array<string, mixed>>>  $workers  per worker, its operations in order
     * @return list<list<array<string, mixed>>> per worker, one result per operation
     */
    public static function run(LedgerFixture $f, array $workers): array
    {
        $env = [...getenv(), 'APP_ENV' => 'testing', 'DB_DATABASE' => (string) config('database.connections.pgsql.database'), 'DB_CONNECTION' => 'pgsql'];
        $procs = [];
        foreach ($workers as $ops) {
            $spec = json_encode(['tenant' => $f->tenantId, 'company' => $f->companyId, 'ops' => $ops], JSON_THROW_ON_ERROR);
            $proc = proc_open([PHP_BINARY, base_path('tests/Concurrency/bin/race-worker.php'), $spec], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
            if ($proc === false) {
                throw new RuntimeException('Could not start a race worker.');
            }
            $procs[] = [$proc, $pipes];
        }

        // Barrier: every worker has booted and is waiting; release them all at once.
        foreach ($procs as [, $pipes]) {
            $line = fgets($pipes[1]);
            if (trim((string) $line) !== 'ready') {
                throw new RuntimeException('A race worker failed to boot: '.stream_get_contents($pipes[2]).$line);
            }
        }
        foreach ($procs as [, $pipes]) {
            fwrite($pipes[0], "go\n");
            fclose($pipes[0]);
        }

        $results = [];
        foreach ($procs as $i => [$proc, $pipes]) {
            $out = stream_get_contents($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            $exit = proc_close($proc);
            if ($exit !== 0) {
                throw new RuntimeException("Race worker {$i} exited {$exit}: {$err}{$out}");
            }
            $results[] = array_map(fn (string $l) => json_decode($l, true, flags: JSON_THROW_ON_ERROR), array_values(array_filter(explode(PHP_EOL, (string) $out))));
        }

        return $results;
    }

    /**
     * @param  list<list<array<string, mixed>>>  $results
     * @return list<array<string, mixed>>
     */
    public static function flatten(array $results): array
    {
        return array_merge(...$results);
    }

    /** @param list<array<string, mixed>> $flat @return list<array<string, mixed>> */
    public static function errors(array $flat): array
    {
        return array_values(array_filter($flat, fn (array $r) => isset($r['error'])));
    }

    /** @param list<array<string, mixed>> $flat @return list<array<string, mixed>> */
    public static function ok(array $flat): array
    {
        return array_values(array_filter($flat, fn (array $r) => isset($r['ok'])));
    }

    /** @param list<array<string, mixed>> $flat @return list<string> refusal codes, sorted */
    public static function refusals(array $flat): array
    {
        $codes = array_map(fn (array $r) => $r['refused'], array_filter($flat, fn (array $r) => isset($r['refused'])));
        sort($codes);

        return array_values($codes);
    }

    /** A second person in the tenant (approvers, requesters). */
    public static function user(LedgerFixture $f, string $name): string
    {
        $id = (string) Str::uuid7();
        DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => strtolower($name).'@race.test', 'password' => 'x']);
        DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);

        return $id;
    }

    /** An active journal workflow for every amount and source. @param list<array{role: string, count?: int}> $steps */
    public static function workflow(LedgerFixture $f, array $steps): void
    {
        (new ApprovalWorkflow)->forceFill([
            'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'document_type' => 'journal',
            'name' => 'Race flow', 'source' => 'any', 'min_amount' => 0, 'max_amount' => null, 'steps' => $steps, 'is_active' => true,
        ])->save();
    }
}
