<?php

declare(strict_types=1);

use App\Domain\Ledger\PostingRejected;
use App\Jobs\Reports\RunReportExport;
use App\Queries\Reports\RunReport;
use App\Support\Reports\LedgerVersion;
use App\Support\Reports\ReportRunner;
use App\Support\Tenancy\NoTenantContext;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Support\ReportScenario;

/*
 * Reports read the reporting connection under the tenant GUC (13 §6, §13) and are cached by ledger_version
 * (13 §13): a posting invalidates at commit, nothing is shared across companies or tenants.
 */

beforeEach(function (): void {
    $this->a = ReportScenario::create('acme');
    $this->a->story();
});

function tbRows(ReportScenario $s): array
{
    $tb = app(RunReport::class)('trial-balance', $s->company(), ['as_of' => '2026-12-31', 'hide_zero' => true]);

    return collect($tb['rows'])->mapWithKeys(fn ($r) => [$r['account']['id'] => $r['debit']['amount'] - $r['credit']['amount']])->all();
}

function reportQueries(Closure $work): int
{
    $db = app(ReportRunner::class)->db();
    $db->flushQueryLog();
    $db->enableQueryLog();
    $work();
    $n = count(array_filter($db->getQueryLog(), fn ($q) => str_contains($q['query'], 'account_period_balances') || str_contains($q['query'], 'journal_lines')));
    $db->disableQueryLog();

    return $n;
}

it('never shows another tenant\'s data on the report connection, whichever tenant was set last', function (): void {
    $companyA = $this->a->company();
    $b = ReportScenario::create('beta');
    $b->post('2026-03-01', [['1000', 777, 0], ['4000', 0, 777]]);
    $b->post('2026-03-02', [['5000', 111, 0], ['1000', 0, 111]]);

    // The fixture of B left B's context set: B sees only B.
    $companyB = $b->company();
    $rowsB = tbRows($b);
    expect(array_keys($rowsB))->each->toBeIn(array_values($b->f->accounts))->and($rowsB[$b->f->account('1000')])->toBe(666);

    // Back to A on the same connection objects: only A's accounts and A's money.
    app(TenantContext::class)->set($this->a->f->tenantId);
    $rowsA = tbRows($this->a);
    expect(array_keys($rowsA))->each->toBeIn(array_values($this->a->f->accounts))->and($rowsA[$this->a->f->account('1000')])->toBe(157_500);

    $db = app(ReportRunner::class)->db();
    expect($db->getName())->toBe(config('reports.connection'))
        ->and($db->selectOne("SELECT current_setting('app.tenant_id') AS t")->t)->toBe($this->a->f->tenantId)
        ->and($db->selectOne('SELECT count(DISTINCT tenant_id) AS n FROM journal_lines')->n)->toBe(1)
        ->and($db->selectOne('SELECT count(*) AS n FROM accounts')->n)->toBe(count($this->a->f->accounts));

    // Even a company id of the other tenant yields nothing, and no tenant at all fails closed.
    $foreign = app(RunReport::class)('trial-balance', $companyB, ['as_of' => '2026-12-31', 'hide_zero' => true]);
    expect($foreign['rows'])->toBe([])->and($foreign['totals']['debit']['amount'])->toBe(0);

    app(TenantContext::class)->clear();
    expect($db->selectOne('SELECT count(*) AS n FROM journal_lines')->n)->toBe(0)
        ->and(fn () => app(RunReport::class)('trial-balance', $companyA, ['as_of' => '2026-12-31']))->toThrow(NoTenantContext::class);
});

it('reads the primary interactively and the read-only replica role for exports (13 §13)', function (): void {
    expect(app(ReportRunner::class)->db()->getName())->toBe('pgsql');

    $seen = [];
    DB::listen(function ($q) use (&$seen): void {
        if (str_contains($q->sql, 'account_period_balances') || str_contains($q->sql, 'journal_lines')) {
            $seen[] = $q->connectionName;
        }
    });
    $tenant = $this->a->f->tenantId;
    app(TenantContext::class)->clear();
    $job = new RunReportExport($tenant, $this->a->f->companyId, (string) Str::uuid7(), 'trial-balance', 'csv', ['as_of' => '2026-12-31']);
    try {
        app()->call([$job, 'handle']);
    } catch (Throwable) {
        // The export record does not exist here; only which connection the ledger reads used matters.
    }
    expect($seen)->not->toBeEmpty()->and(array_unique($seen))->toBe(['pgsql_report'])
        ->and(config('reports.connection'))->toBe('pgsql');
});

it('is read-only: the report role cannot write', function (): void {
    $db = DB::connection(config('reports.export_connection'));
    expect(fn () => $db->statement("UPDATE accounts SET name = 'x'"))->toThrow(QueryException::class);
});

it('caches by company, report, parameters and ledger_version, and a posting invalidates at once', function (): void {
    $run = fn () => app(RunReport::class)('profit-and-loss', $this->a->company(), ['period_id' => $this->a->periodId('2026-01-15')]);
    $first = $run();
    expect($first['subtotals']['net_profit']['amount']['amount'])->toBe(42_000);

    // Second call: same bytes, no read of the ledger tables.
    $queries = reportQueries(function () use ($run, $first): void {
        expect($run())->toBe($first);
    });
    expect($queries)->toBe(0);

    $versions = app(LedgerVersion::class);
    $before = $versions->current($this->a->f->tenantId, $this->a->f->companyId);
    $this->a->post('2026-01-31', [['1000', 5_000, 0], ['4000', 0, 5_000]]);
    expect($versions->current($this->a->f->tenantId, $this->a->f->companyId))->toBe($before + 1);

    $after = $run();
    expect($after['subtotals']['net_profit']['amount']['amount'])->toBe(47_000)->and(reportQueries($run))->toBe(0);

    // A rejected posting rolls back and leaves the version alone.
    $v = $versions->current($this->a->f->tenantId, $this->a->f->companyId);
    expect(fn () => $this->a->post('2026-02-10', [['1000', 5, 0], ['4000', 0, 4]]))->toThrow(PostingRejected::class)
        ->and($versions->current($this->a->f->tenantId, $this->a->f->companyId))->toBe($v);
});

it('keeps versions and keys apart per company and per tenant', function (): void {
    $runner = app(ReportRunner::class);
    $versions = app(LedgerVersion::class);
    $tenant = $this->a->f->tenantId;
    $otherCompany = (string) Str::uuid7();

    $k1 = $runner->key($tenant, $this->a->f->companyId, 'trial_balance', ['to' => '2026-01-31']);
    $k2 = $runner->key($tenant, $otherCompany, 'trial_balance', ['to' => '2026-01-31']);
    $k3 = $runner->key((string) Str::uuid7(), $this->a->f->companyId, 'trial_balance', ['to' => '2026-01-31']);
    expect([$k1, $k2, $k3])->each->toStartWith('report:')->and(array_unique([$k1, $k2, $k3]))->toHaveCount(3)
        ->and($k1)->toContain($tenant)->toContain($this->a->f->companyId);

    $bBefore = $versions->current($tenant, $otherCompany);
    $versions->bump($tenant, $this->a->f->companyId);
    expect($versions->current($tenant, $otherCompany))->toBe($bBefore);

    // A flushed counter restarts at a new random epoch, never at a number an old key could still hold.
    $old = $versions->current($tenant, $this->a->f->companyId);
    Cache::flush();
    expect($versions->current($tenant, $this->a->f->companyId))->not->toBe($old);
});

it('caches the parameters, not just the report: another period is another entry', function (): void {
    $jan = app(RunReport::class)('profit-and-loss', $this->a->company(), ['period_id' => $this->a->periodId('2026-01-15')]);
    $feb = app(RunReport::class)('profit-and-loss', $this->a->company(), ['period_id' => $this->a->periodId('2026-02-15')]);
    expect($jan['subtotals']['net_profit']['amount']['amount'])->toBe(42_000)->and($feb['subtotals']['net_profit']['amount']['amount'])->toBe(-1_500);
});
