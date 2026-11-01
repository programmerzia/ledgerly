<?php

declare(strict_types=1);

use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

it('makes a second apply wait for the first and then refuses it, instead of failing on a duplicate code', function () {
    $f = LedgerFixture::create(); // the real permission checker: the creator is the new company's Owner
    $company = app(CreateCompany::class)->handle($f->actor, new CreateCompanyInput('Race Co', 'US', 'USD', 1));

    // Stand in for an apply that is already in flight: it holds the company row.
    $inFlight = DB::connection('pgsql_audit');
    $inFlight->beginTransaction();

    try {
        $inFlight->selectOne('SELECT id FROM companies WHERE id = ? FOR UPDATE', [$company->id]);

        $env = [...getenv(), 'APP_ENV' => 'testing', 'DB_DATABASE' => (string) config('database.connections.pgsql.database'), 'DB_CONNECTION' => 'pgsql'];
        $cmd = [PHP_BINARY, base_path('tests/Concurrency/bin/apply-chart-template.php'), $f->tenantId, $company->id, $f->userId, 'ifrs_sme'];
        $worker = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
        expect($worker)->not->toBeFalse();

        // Wait until the worker is really blocked on the row lock, not merely slow to start.
        $deadline = microtime(true) + 20;
        do {
            usleep(100_000);
            $blocked = (int) DB::selectOne(
                "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%for no key update%'"
            )->n;
        } while ($blocked === 0 && microtime(true) < $deadline);
        expect($blocked)->toBe(1);

        // The first apply finishes: its chart is committed while the worker still waits.
        $inFlight->table('accounts')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $company->id,
            'code' => '1000', 'name' => 'Cash on hand', 'account_type' => 'asset', 'normal_balance' => 'debit',
        ]);
        $inFlight->commit();
    } finally {
        if ($inFlight->transactionLevel() > 0) {
            $inFlight->rollBack();
        }
    }

    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    $exit = proc_close($worker);

    expect($exit)->toBe(0, $err)
        ->and(trim((string) $out))->toBe('refused chart_not_empty')
        ->and(DB::table('accounts')->where('company_id', $company->id)->count())->toBe(1);
})->group('concurrency');
