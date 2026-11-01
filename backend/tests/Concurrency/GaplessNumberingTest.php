<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

it('allocates unique, gapless numbers under parallel posting from separate processes', function () {
    $f = LedgerFixture::create();
    $workers = 5;
    $perWorker = 10;

    $env = [...getenv(), 'APP_ENV' => 'testing', 'DB_DATABASE' => (string) config('database.connections.pgsql.database'), 'DB_CONNECTION' => 'pgsql'];
    $procs = [];
    for ($w = 0; $w < $workers; $w++) {
        $cmd = [PHP_BINARY, base_path('tests/Concurrency/bin/post-journals.php'), $f->tenantId, $f->companyId, $f->userId, $f->account('1000'), $f->account('4000'), (string) $perWorker];
        $procs[] = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
        $io[] = $pipes;
    }

    $numbers = [];
    foreach ($procs as $i => $proc) {
        $out = stream_get_contents($io[$i][1]);
        $err = stream_get_contents($io[$i][2]);
        $exit = proc_close($proc);
        expect($exit)->toBe(0, $err);
        array_push($numbers, ...array_filter(explode(PHP_EOL, (string) $out)));
    }

    $expected = array_map(fn (int $n) => sprintf('JV-FY2026-%05d', $n), range(1, $workers * $perWorker));
    sort($numbers);
    expect($numbers)->toBe($expected)
        ->and(DB::table('journals')->where('status', 'posted')->orderBy('number')->pluck('number')->all())->toBe($expected)
        ->and((int) DB::table('account_period_balances')->where('account_id', $f->account('1000'))->value('debit'))
        ->toBe($workers * array_sum(range(1, $perWorker)));
})->group('concurrency');
