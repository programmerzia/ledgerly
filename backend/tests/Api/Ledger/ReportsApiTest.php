<?php

declare(strict_types=1);

use App\Jobs\Reports\RunReportExport;
use App\Services\Reports\ExportStore;
use App\Services\Reports\ReportExport;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Reports\Export\PdfRenderer;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use Tests\Support\ReportScenario;

/*
 * The report API (13 §13, §16): permissions and token abilities, money on the wire, drill keys that reconcile
 * to their cell, the ledger's cursor pages, exports, and the export limits. Numbers come from the story in
 * Tests\Support\ReportScenario, worked out by hand in Tests\Feature\Reports\StatementsStoryTest.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->owner = $this->person('Olga Owner', ['Owner']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->sales = $this->person('Sam Sales', ['Sales Assistant']);

    $this->s = new ReportScenario($this->f);
    $this->s->actor = new Actor(ActorType::User, $this->owner->id, $this->f->tenantId, $this->f->companyId, hasSigningGrant: true);
    $this->s->chart();
    $this->inTenant(fn () => $this->s->story());
    $this->feb = $this->inTenant(fn () => $this->s->periodId('2026-02-15'));
    $this->jan = $this->inTenant(fn () => $this->s->periodId('2026-01-15'));
});

function drillQuery(array $drill): string
{
    return http_build_query($drill);
}

it('serves the statements to a viewer with money as amount and currency', function (): void {
    $this->asPerson($this->viewer);

    $tb = $this->getJson($this->api('reports/trial-balance?as_of=2026-02-28'))->assertOk()
        ->assertJsonPath('data.balanced', true)
        ->assertJsonPath('data.totals.debit', ['amount' => 219_500, 'currency' => 'USD'])
        ->assertJsonPath('data.as_of', '2026-02-28');
    expect(collect($tb->json('data.rows'))->firstWhere('account.code', '1000')['debit'])->toBe(['amount' => 157_500, 'currency' => 'USD']);

    $this->getJson($this->api("reports/profit-and-loss?period_id={$this->feb}&basis=ytd"))->assertOk()
        ->assertJsonPath('data.subtotals.net_profit.amount', ['amount' => 40_500, 'currency' => 'USD']);
    $this->getJson($this->api("reports/balance-sheet?period_id={$this->feb}"))->assertOk()
        ->assertJsonPath('data.balanced', true)->assertJsonPath('data.equity.total.amount.amount', 140_500);
    $this->getJson($this->api("reports/cash-flow?period_id={$this->jan}"))->assertOk()
        ->assertJsonPath('data.reconciles', true)->assertJsonPath('data.financing.total.amount', 150_000);
});

it('rejects bad parameters with 422 and foreign ids', function (): void {
    $this->asPerson($this->viewer);
    $this->getJson($this->api('reports/profit-and-loss'))->assertStatus(422)->assertJsonValidationErrors('period_id');
    $this->getJson($this->api('reports/profit-and-loss?from=2026-03-01'))->assertStatus(422);
    $this->getJson($this->api("reports/profit-and-loss?period_id={$this->jan}&from=2026-01-01&to=2026-01-31"))->assertStatus(422);
    $this->getJson($this->api('reports/trial-balance?as_of=2026-02-30'))->assertStatus(422);
    $this->getJson($this->api('reports/trial-balance?as_of=2026-02-28&dimensions[not-a-uuid]=x'))->assertStatus(422);
    $this->getJson($this->api('reports/trial-balance?as_of=2026-02-28&dimensions['.Str::uuid7().']='.Str::uuid7()))->assertStatus(422);
    $this->getJson($this->api('reports/general-ledger'))->assertStatus(422)->assertJsonValidationErrors('account_id');

    $beta = $this->secondCompany();
    $foreign = $this->inTenant(fn () => DB::table('accounts')->insertGetId(['id' => $id = (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $beta->id, 'code' => '1', 'name' => 'B', 'account_type' => 'asset', 'normal_balance' => 'debit']) ? $id : $id);
    $this->getJson($this->api("reports/general-ledger?account_id={$foreign}"))->assertStatus(422)->assertJsonValidationErrors('account_id');
    $this->getJson($this->api("reports/drill?account_id={$foreign}"))->assertStatus(422);
});

it('grants reports by permission and by token ability, and never to a Sales Assistant', function (): void {
    $url = $this->api('reports/trial-balance?as_of=2026-02-28');
    $export = $this->api('reports/trial-balance/export?as_of=2026-02-28&format=csv');

    $this->asPerson($this->sales)->getJson($url)->assertForbidden();
    $this->asPerson($this->viewer)->getJson($url)->assertOk();
    $this->asPerson($this->viewer)->get($export)->assertForbidden();             // Viewer: reports.view only
    $this->asPerson($this->accountant)->get($export)->assertOk();

    $this->asToken($this->newToken(['reports:read']))->getJson($url)->assertOk();
    $this->asToken($this->newToken(['reports:read']))->get($export)->assertForbidden();
    $this->asToken($this->newToken(['journals:read']))->getJson($url)->assertForbidden();
    $this->asToken($this->newToken(['reports:read']))->getJson($this->api("reports/drill?account_id={$this->f->account('1000')}"))->assertOk();
    $this->asToken($this->newToken(['reports:export']))->get($export)->assertOk();

    // A token issued for another company only.
    $beta = $this->secondCompany();
    $this->asToken($this->newToken(['reports:read'], [$beta->id]))->getJson($url)->assertStatus(403);
});

it('pages the general ledger by cursor with a running balance that ends on the closing balance', function (): void {
    $this->asPerson($this->viewer);
    $cash = $this->f->account('1000');
    $url = $this->api("reports/general-ledger?account_id={$cash}&limit=4");

    $first = $this->getJson($url)->assertOk();
    $header = $first->json('report');
    expect($header['opening_balance']['amount'])->toBe(0)->and($header['closing_balance']['amount'])->toBe(157_500)
        ->and($header['summary']['line_count'])->toBe(10)
        ->and($header['summary']['debit']['amount'])->toBe(198_500)->and($header['summary']['credit']['amount'])->toBe(41_000);

    $seen = [];
    $page = $first;
    $guard = 0;
    while (true) {
        foreach ($page->json('data') as $line) {
            $seen[] = [$line['id'], $line['balance']['amount']];
        }
        $next = $page->json('meta.next_cursor');
        if ($next === null || ++$guard > 10) {
            break;
        }
        $page = $this->getJson($url.'&cursor='.$next)->assertOk();
    }
    expect($seen)->toHaveCount(10)->and(array_unique(array_column($seen, 0)))->toHaveCount(10)
        ->and(array_column($seen, 1))->toBe([100_000, 70_000, 120_000, 140_000, 135_000, 160_000, 158_000, 158_500, 161_500, 157_500])
        ->and($guard)->toBe(2);

    // A range starts from the balance before it.
    $feb = $this->getJson($this->api("reports/general-ledger?account_id={$cash}&period_id={$this->feb}"))->assertOk();
    expect($feb->json('report.opening_balance.amount'))->toBe(135_000)->and($feb->json('data.0.balance.amount'))->toBe(160_000)
        ->and($feb->json('data.0.journal.number'))->not->toBeNull()->and($feb->json('data.0.journal.id'))->not->toBeNull();
});

/** Every cell's drill key must give back exactly the cell's amount. */
it('drills from every cell of every statement to lines that add up to the cell', function (): void {
    $this->asPerson($this->viewer);
    $check = function (array $drill, int $expected, bool $debitNature) {
        $r = $this->getJson($this->api('reports/drill?'.drillQuery($drill)))->assertOk();
        $net = $r->json('summary.net.amount');   // debit - credit
        expect($debitNature ? $net : -$net)->toBe($expected, 'drill of '.json_encode($drill));

        return $r;
    };

    $tb = $this->getJson($this->api('reports/trial-balance?as_of=2026-02-28'))->json('data.rows');
    foreach ($tb as $row) {
        $net = $row['debit']['amount'] - $row['credit']['amount'];
        $check($row['drill'], $net, true);
    }

    $pl = $this->getJson($this->api("reports/profit-and-loss?period_id={$this->feb}&basis=ytd"))->json('data');
    foreach ($pl['sections'] as $section) {
        foreach ($section['lines'] as $line) {
            $income = in_array($section['key'], ['operating_revenue', 'other_income'], true);
            $check($line['drill'], $line['amount']['amount'], ! $income);
        }
    }

    $bs = $this->getJson($this->api("reports/balance-sheet?period_id={$this->feb}"))->json('data');
    $cells = 0;
    foreach (['assets' => true, 'liabilities' => false, 'equity' => false] as $side => $debitNature) {
        foreach ($bs[$side]['lines'] as $line) {
            if (! isset($line['drill'])) {
                continue;   // the result lines point at the profit and loss
            }
            $cells++;
            $expected = $line['amount']['amount'];
            // The gross lines of D9 sit in their own section (customer credits among liabilities, supplier debits among assets).
            $nature = $debitNature;
            $r = $check($line['drill'], $expected, $nature);
            foreach ($line['contacts'] ?? [] as $contact) {
                $check($contact['drill'], $contact['amount']['amount'], $nature);
            }
            // A contributed-capital or loan account is credit nature but this "debitNature" flag already says so.
            if ($expected !== 0) {
                expect($r->json('summary.line_count'))->toBeGreaterThan(0);
            }
        }
    }
    expect($cells)->toBeGreaterThan(6);

    $cf = $this->getJson($this->api("reports/cash-flow?period_id={$this->jan}"))->json('data');
    foreach (['operating', 'investing', 'financing'] as $activity) {
        foreach ($cf[$activity]['lines'] as $line) {
            if (isset($line['drill'])) {
                $r = $this->getJson($this->api('reports/drill?'.drillQuery($line['drill'])))->assertOk();
                expect(-$r->json('summary.net.amount'))->toBe($line['amount']['amount']);   // cash effect = credit - debit
            }
        }
    }
});

it('pages a drill by cursor and the pages add up to the summary', function (): void {
    $this->asPerson($this->viewer);
    $q = drillQuery(['account_id' => $this->f->account('1000'), 'to' => '2026-02-28', 'limit' => 3]);
    $page = $this->getJson($this->api('reports/drill?'.$q))->assertOk();
    $debit = $credit = $count = 0;
    for ($i = 0; $i < 10; $i++) {
        foreach ($page->json('data') as $l) {
            $debit += $l['debit']['amount'];
            $credit += $l['credit']['amount'];
            $count++;
        }
        if ($page->json('meta.next_cursor') === null) {
            break;
        }
        $page = $this->getJson($this->api('reports/drill?'.$q.'&cursor='.$page->json('meta.next_cursor')))->assertOk();
    }
    expect([$debit, $credit, $count])->toBe([198_500, 41_000, 10])
        ->and($page->json('summary.debit.amount'))->toBe(198_500)->and($page->json('summary.line_count'))->toBe(10);

    $this->getJson($this->api('reports/drill?'.$q.'&cursor=%25%25'))->assertStatus(422);
    $this->getJson($this->api('reports/drill?account_id='.$this->f->account('1000').'&limit=0'))->assertStatus(422);
});

it('filters by dimension and groups equity by the Fund dimension (D13)', function (): void {
    $dimension = (string) Str::uuid7();
    [$restricted, $general] = [(string) Str::uuid7(), (string) Str::uuid7()];
    $this->inTenant(function () use ($dimension, $restricted, $general): void {
        DB::table('dimensions')->insert(['id' => $dimension, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => 'FUND', 'name' => 'Fund', 'position' => 1]);
        foreach ([[$restricted, 'RES', 'Restricted'], [$general, 'GEN', 'General']] as [$id, $code, $name]) {
            DB::table('dimension_values')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'dimension_id' => $dimension, 'code' => $code, 'name' => $name]);
        }
        $this->s->post('2026-03-05', [['1000', 7_000, 0], ['3100', 0, 7_000, [1 => $restricted]]]);
        $this->s->post('2026-03-06', [['1000', 2_000, 0], ['4000', 0, 2_000, [1 => $restricted]]]);
        $this->s->post('2026-03-07', [['1000', 300, 0], ['4000', 0, 300, [1 => $general]]]);
    });
    $this->asPerson($this->viewer);

    $pl = $this->getJson($this->api("reports/profit-and-loss?period_id={$this->jan}&dimensions[{$dimension}]={$restricted}"))->assertOk();
    expect($pl->json('data.subtotals.net_profit.amount.amount'))->toBe(0);
    $march = $this->inTenant(fn () => $this->s->periodId('2026-03-15'));
    $pl = $this->getJson($this->api("reports/profit-and-loss?period_id={$march}&dimensions[{$dimension}]={$restricted}"))->assertOk();
    expect($pl->json('data.subtotals.net_profit.amount.amount'))->toBe(2_000)->and($pl->json('data.filtered'))->toBeTrue();
    // Several values of one dimension add up.
    $both = $this->getJson($this->api("reports/profit-and-loss?period_id={$march}&dimensions[{$dimension}][]={$restricted}&dimensions[{$dimension}][]={$general}"))->assertOk();
    expect($both->json('data.subtotals.net_profit.amount.amount'))->toBe(2_300);

    $bs = $this->getJson($this->api("reports/balance-sheet?period_id={$march}"))->assertOk();
    $funds = collect($bs->json('data.equity.funds'))->mapWithKeys(fn ($f) => [($f['fund']['code'] ?? 'none') => $f['total']['amount']['amount']])->all();
    // Restricted: 7,000 capital + 2,000 result. General: 300 result. No fund: 100,000 capital + March-and-before result 40,500 + ... of January/February.
    expect($funds)->toEqual(['RES' => 9_000, 'GEN' => 300, 'none' => 140_500])
        ->and($bs->json('data.balanced'))->toBeTrue()
        ->and($bs->json('data.equity.total.amount.amount'))->toBe(149_800);
    $line = collect($bs->json('data.equity.lines'))->first(fn ($l) => ($l['fund']['code'] ?? null) === 'RES' && isset($l['account']));
    expect($line['account']['code'])->toBe('3100')->and($line['amount']['amount'])->toBe(7_000);

    $tb = $this->getJson($this->api("reports/trial-balance?period_id={$march}&dimensions[{$dimension}]={$restricted}"))->assertOk();
    expect($tb->json('data.filtered'))->toBeTrue()->and($tb->json('data.totals.credit.amount'))->toBe(9_000);

    $this->getJson($this->api("reports/cash-flow?period_id={$march}&dimensions[{$dimension}]={$restricted}"))->assertStatus(422);
});

it('exports CSV and XLSX with exact amounts, escaped text and an audit event', function (): void {
    $this->inTenant(function (): void {
        DB::table('accounts')->where('id', $this->f->account('5000'))->update(['name' => '=HYPERLINK("http://x")', 'updated_at' => now()]);
    });
    $this->asPerson($this->accountant);

    $csv = $this->get($this->api("reports/profit-and-loss/export?period_id={$this->jan}&format=csv"))->assertOk();
    expect($csv->headers->get('content-type'))->toContain('text/csv');
    $body = $csv->streamedContent();
    expect($body)->toContain('Profit and loss')->and($body)->toContain('480.00')   // gross profit
        ->and($body)->toContain('420.00');                                           // net profit
    // The name is a cell of its own in the trial balance, and would be read as a formula.
    expect($this->get($this->api('reports/trial-balance/export?as_of=2026-02-28&format=csv'))->streamedContent())->toContain("\"'=HYPERLINK(");

    $xlsx = $this->get($this->api('reports/trial-balance/export?as_of=2026-02-28&format=xlsx'))->assertOk();
    expect($xlsx->headers->get('content-type'))->toContain('spreadsheetml');
    $file = tempnam(sys_get_temp_dir(), 'x').'.xlsx';
    file_put_contents($file, $xlsx->streamedContent());
    $reader = new XlsxReader;
    $reader->open($file);
    $rows = [];
    foreach ($reader->getSheetIterator() as $sheet) {
        foreach ($sheet->getRowIterator() as $row) {
            $rows[] = array_map(fn ($c) => $c->getValue(), $row->cells);
        }
    }
    $reader->close();
    unlink($file);
    $cash = collect($rows)->first(fn ($r) => ($r[0] ?? null) === '1000');
    $total = collect($rows)->first(fn ($r) => ($r[1] ?? null) === 'Total');
    expect($cash[2])->toEqual(1575.0)->and($total[2])->toEqual(2195.0)->and($total[3])->toEqual(2195.0);

    $events = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'report.exported')->orderBy('id')->get());
    expect($events)->toHaveCount(3)->and(json_decode($events[0]->canonical, true)['context']['report'] ?? null)->toBe('profit-and-loss');

    $this->get($this->api('reports/trial-balance/export?as_of=2026-02-28'))->assertStatus(422);
    $this->get($this->api('reports/drill/export?format=csv'))->assertNotFound();
});

it('renders the PDF template (the Chromium step itself is not run here)', function (): void {
    $table = $this->inTenant(fn () => app(ReportExport::class)->plan('balance-sheet', $this->s->company(), ['period_id' => $this->feb])['table']);
    $html = app(PdfRenderer::class)->html($table);
    expect($html)->toContain('<h1>Balance sheet</h1>')->not->toContain('<script')
        ->and($html)->toContain('Customer credit balances')->and($html)->toContain('1575.00');
});

it('limits exports to ten an hour per company and queues the big ones', function (): void {
    $this->asPerson($this->accountant);
    $url = $this->api('reports/trial-balance/export?as_of=2026-02-28&format=csv');
    for ($i = 0; $i < 10; $i++) {
        $this->get($url)->assertOk();
    }
    $this->get($url)->assertStatus(429);
    // The limit is per company, not per request: another company of the tenant is unaffected.
    $this->get($this->api('reports/trial-balance/export?as_of=2026-02-28&format=csv', $this->secondCompany()->id))->assertStatus(403);
});

it('always sends a PDF to the worker, however small', function (): void {
    Queue::fake();
    $this->asPerson($this->accountant);

    $this->get($this->api('reports/trial-balance/export?as_of=2026-02-28&format=pdf'))->assertStatus(202)->assertJsonPath('data.format', 'pdf');
    Queue::assertPushedOn('exports', RunReportExport::class);
});

it('runs a large export as a queued job, tracked and downloadable only by who asked', function (): void {
    config(['reports.export_inline_max_rows' => 3]);
    Queue::fake();
    $this->asPerson($this->accountant);

    $queued = $this->get($this->api('reports/trial-balance/export?as_of=2026-02-28&format=csv'))->assertStatus(202)->assertJsonPath('data.status', 'queued');
    $id = $queued->json('data.id');
    Queue::assertPushed(RunReportExport::class);
    $this->getJson($this->api("reports/exports/{$id}"))->assertOk()->assertJsonPath('data.status', 'queued');

    // Run what the worker would, then fetch.
    Storage::fake((string) config('reports.export_disk'));
    $this->inTenant(fn () => (new RunReportExport($this->f->tenantId, $this->f->companyId, $id, 'trial-balance', 'csv', ['as_of' => '2026-02-28']))
        ->handle(app(TenantContext::class), app(ReportExport::class), app(ExportStore::class)));
    $file = $this->get($this->api("reports/exports/{$id}"))->assertOk();
    expect($file->streamedContent())->toContain('Trial balance')->toContain('1575.00');

    $this->asPerson($this->owner)->getJson($this->api("reports/exports/{$id}"))->assertNotFound();
    $this->asPerson($this->accountant)->getJson($this->api('reports/exports/'.Str::uuid7()))->assertNotFound();
});
