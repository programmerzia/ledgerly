<?php

declare(strict_types=1);

use App\Actions\Imports\ApplyImport;
use App\Jobs\Imports\ApplyImportJob;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Support\BankingApi;
use Tests\Support\ImportsApi;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/*
 * Imports (plan 2.18). Row numbers are the sheet's own: the header is row 1, so the first data row is 2. USD has two decimals.
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class, ImportsApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
});

const CONTACTS_CSV = <<<'CSV'
Cust ID,Company Name,Email,Tax Number,Terms
CUST-009,Dahabshiil Telecom Inc,billing@dahabshiil.so,SO-9821-X,30
CUST-010,Telesom Somaliland Ltd,accounts@telesom.com,SL-4810-T,15
CUST-011,,info@unnamed.org,,30
CUST-012,Golis Telecom Puntland,finance@golis.net,PL-3920-G,30
C1,Duplicate of a fixture,dup@example.com,,10

CSV;

const CONTACT_MAP = ['code' => 'Cust ID', 'name' => 'Company Name', 'email' => 'Email', 'tax_id' => 'Tax Number', 'payment_terms_days' => 'Terms'];

// ---- the flow, on contacts ----

it('detects the columns, suggests a mapping, previews with numbered errors and writes nothing', function (): void {
    $upload = $this->upload('contacts', CONTACTS_CSV)->assertCreated();
    expect($upload->json('data.status'))->toBe('uploaded')
        ->and($upload->json('data.rows_total'))->toBe(5)
        ->and($upload->json('data.columns'))->toBe(['Cust ID', 'Company Name', 'Email', 'Tax Number', 'Terms'])
        ->and($upload->json('data.suggestion_source'))->toBe('headers')
        ->and($upload->json('data.suggested_mapping.columns'))->toBe(CONTACT_MAP);

    $before = [$this->rowCount('contacts'), $this->rowCount('accounts'), $this->rowCount('invoices'), $this->rowCount('journals')];
    $import = $this->mapAndPreview($upload->json('data'), $upload->json('data.suggested_mapping.columns'));

    expect($import['status'])->toBe('previewed')->and($import['rows_valid'])->toBe(3)->and($import['rows_invalid'])->toBe(2);
    $rows = $this->rowsOf($import['id']);
    expect($rows[4]['status'])->toBe('invalid')->and($rows[4]['errors'][0]['field'])->toBe('name')
        ->and($rows[6]['status'])->toBe('invalid')->and($rows[6]['errors'][0]['code'])->toBe('contact_code_taken')
        ->and([$rows[2]['status'], $rows[3]['status'], $rows[5]['status']])->toBe(['valid', 'valid', 'valid'])
        ->and([$this->rowCount('contacts'), $this->rowCount('accounts'), $this->rowCount('invoices'), $this->rowCount('journals')])->toBe($before)
        ->and($this->rowCount('contacts'))->toBe(3, 'only the fixture contacts exist');
});

it('applies the valid rows on the queue, reports per row, and applying again does nothing', function (): void {
    $import = $this->previewed('contacts', CONTACTS_CSV, CONTACT_MAP);

    $this->requestApply($import['id'])->assertStatus(202)->assertJsonPath('data.status', 'queued');
    expect($this->rowCount('contacts'))->toBe(3, 'nothing is created until the job runs');
    $this->runJob($import['id']);

    $done = $this->importOf($import['id']);
    expect($done['status'])->toBe('completed')->and($done['rows_applied'])->toBe(3)->and($done['rows_failed'])->toBe(0)->and($done['rows_invalid'])->toBe(2);
    $contacts = $this->inTenant(fn () => DB::table('contacts')->whereIn('code', ['CUST-009', 'CUST-010', 'CUST-012', 'CUST-011'])->orderBy('code')->get(['code', 'name', 'kind', 'payment_terms_days', 'email', 'default_currency'])->all());
    expect(array_column($contacts, 'code'))->toBe(['CUST-009', 'CUST-010', 'CUST-012'])
        ->and(array_column($contacts, 'payment_terms_days'))->toBe([30, 15, 30])
        ->and($contacts[1]->email)->toBe('accounts@telesom.com')->and($contacts[0]->kind)->toBe('customer')->and($contacts[0]->default_currency)->toBe('USD');
    $rows = $this->rowsOf($import['id']);
    expect($rows[2]['status'])->toBe('applied')->and($rows[2]['result']['code'])->toBe('CUST-009')->and($rows[4]['status'])->toBe('invalid');

    // Asking again, or running the job again, changes nothing.
    $this->requestApply($import['id'])->assertOk()->assertJsonPath('data.status', 'completed');
    $this->runJob($import['id']);
    expect($this->rowCount('contacts'))->toBe(6)->and($this->importOf($import['id'])['rows_applied'])->toBe(3);
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'import.applied')->count())->toBe(1));
});

it('queues exactly one job on the imports queue, and only after the previewed state', function (): void {
    config(['queue.default' => 'database']);
    Queue::fake();
    $upload = $this->upload('contacts', CONTACTS_CSV)->assertCreated()->json('data');
    // not previewed yet
    $this->requestApply($upload['id'])->assertStatus(409)->assertJsonPath('code', 'import_state_invalid');
    $import = $this->mapAndPreview($upload, CONTACT_MAP);

    $this->requestApply($import['id'])->assertStatus(202);
    $this->requestApply($import['id'])->assertStatus(202);
    Queue::assertPushed(ApplyImportJob::class, 1);
    Queue::assertPushedOn('imports', ApplyImportJob::class);
});

it('suggests the last mapping used for the kind when the new file still fits it', function (): void {
    $this->previewed('contacts', CONTACTS_CSV, CONTACT_MAP);
    $again = $this->upload('contacts', CONTACTS_CSV)->assertCreated();

    expect($again->json('data.suggestion_source'))->toBe('saved')->and($again->json('data.suggested_mapping.columns'))->toBe(CONTACT_MAP);
    // A file with other headers falls back to guessing from the names.
    $other = $this->upload('contacts', "code,name\nX1,Xavier\n")->assertCreated();
    expect($other->json('data.suggestion_source'))->toBe('headers')->and($other->json('data.suggested_mapping.columns'))->toBe(['code' => 'code', 'name' => 'name']);
});

it('refuses a mapping that names a missing column or leaves a required field out', function (): void {
    $upload = $this->upload('contacts', CONTACTS_CSV)->assertCreated()->json('data');
    $r = $this->asPerson($this->owner)->putJson($this->api("imports/{$upload['id']}/mapping"), ['version' => 0, 'columns' => ['code' => 'Nope']], $this->key())->assertStatus(422);
    expect($r->json('code'))->toBe('mapping_invalid')->and(array_column($r->json('violations'), 'code'))->toContain('mapping_invalid', 'mapping_required');

    // Stale version.
    $this->asPerson($this->owner)->putJson($this->api("imports/{$upload['id']}/mapping"), ['version' => 7, 'columns' => CONTACT_MAP], $this->key())->assertStatus(409);
});

it('takes a constant for an empty cell: kind and currency defaults', function (): void {
    $csv = "Code,Name\nS-100,Supplier One\n";
    $import = $this->previewed('contacts', $csv, ['code' => 'Code', 'name' => 'Name'], defaults: ['kind' => 'supplier', 'default_currency' => 'eur']);
    expect($import['rows_valid'])->toBe(1);
    $this->requestApply($import['id'])->assertStatus(202);
    $this->runJob($import['id']);

    $row = $this->inTenant(fn () => DB::table('contacts')->where('code', 'S-100')->first());
    expect($row->kind)->toBe('supplier')->and($row->default_currency)->toBe('EUR');
});

it('resumes a retried job without touching rows already applied', function (): void {
    $csv = "Cust ID,Company Name\nR-1,One\nR-2,Two\nR-3,Three\n";
    $import = $this->previewed('contacts', $csv, ['code' => 'Cust ID', 'name' => 'Company Name']);
    $this->requestApply($import['id'])->assertStatus(202);
    $this->runJob($import['id']);

    // Put the world back as if the first attempt had died after committing row 2: R-3 and R-4 not yet created, import still applying.
    $firstId = $this->inTenant(fn () => DB::table('contacts')->where('code', 'R-1')->value('id'));
    $this->inTenant(function () use ($import): void {
        DB::table('contacts')->whereIn('code', ['R-2', 'R-3'])->delete();
        DB::table('import_rows')->where('import_id', $import['id'])->whereIn('row_number', [3, 4])->update(['status' => 'valid', 'result' => null, 'applied_at' => null]);
        DB::table('imports')->where('id', $import['id'])->update(['status' => 'applying', 'finished_at' => null]);
    });

    // A second worker that is not a retry leaves an applying import alone.
    $this->inTenant(fn () => expect(app(ApplyImport::class)->handle($this->f->tenantId, $this->f->companyId, $import['id'], retry: false))->toBeNull());
    expect($this->rowCount('contacts'))->toBe(4);
    $this->inTenant(fn () => app(ApplyImport::class)->handle($this->f->tenantId, $this->f->companyId, $import['id'], retry: true));

    $codes = $this->inTenant(fn () => DB::table('contacts')->whereIn('code', ['R-1', 'R-2', 'R-3'])->orderBy('code')->pluck('id', 'code')->all());
    expect(array_keys($codes))->toBe(['R-1', 'R-2', 'R-3'])->and($codes['R-1'])->toBe($firstId, 'the row applied before the crash was not repeated')
        ->and($this->rowCount('contacts'))->toBe(6)->and($this->importOf($import['id'])['status'])->toBe('completed')->and($this->importOf($import['id'])['rows_applied'])->toBe(3);
});

it('names a row the Action refuses at apply time and carries on with the others', function (): void {
    $csv = "Code,Name\nF-1,First\nF-2,Second\nF-3,Third\n";
    $import = $this->previewed('contacts', $csv, ['code' => 'Code', 'name' => 'Name']);
    // Someone creates F-2 between the preview and the apply.
    $this->inTenant(fn () => $this->t->contact('F-2', 'customer'));
    $this->requestApply($import['id'])->assertStatus(202);
    $this->runJob($import['id']);

    $done = $this->importOf($import['id']);
    $rows = $this->rowsOf($import['id']);
    expect($done['status'])->toBe('completed')->and($done['rows_applied'])->toBe(2)->and($done['rows_failed'])->toBe(1)
        ->and($rows[3]['status'])->toBe('failed')->and($rows[3]['errors'][0]['code'])->toBe('contact_code_taken')
        ->and($rows[2]['status'])->toBe('applied')->and($rows[4]['status'])->toBe('applied');
});

// ---- chart of accounts ----

it('imports a chart: parents by code, even from an earlier row, with the normal balance following the type', function (): void {
    $csv = <<<'CSV'
Code,Name,Type,Parent,Postable
1500,Fixed assets,asset,,no
1510,Equipment,asset,1500,yes
1520,Vehicles,asset,8888,yes
1530,Furniture,asset,1540,yes
2500,Long term loans,liability,,yes
CSV;
    $import = $this->previewed('accounts', $csv, ['code' => 'Code', 'name' => 'Name', 'account_type' => 'Type', 'parent' => 'Parent', 'is_postable' => 'Postable']);

    $rows = $this->rowsOf($import['id']);
    expect($import['rows_valid'])->toBe(3)->and($import['rows_invalid'])->toBe(2)
        ->and($rows[4]['errors'][0]['field'])->toBe('parent')->and($rows[4]['errors'][0]['code'])->toBe('code_not_found')
        ->and($rows[5]['errors'][0]['field'])->toBe('parent');

    $this->requestApply($import['id'])->assertStatus(202);
    $this->runJob($import['id']);
    $accounts = $this->inTenant(fn () => DB::table('accounts')->whereIn('code', ['1500', '1510', '2500'])->get()->keyBy('code'));
    expect($accounts['1510']->parent_id)->toBe($accounts['1500']->id)->and($accounts['1510']->normal_balance)->toBe('debit')
        ->and($accounts['2500']->normal_balance)->toBe('credit')->and((bool) $accounts['1500']->is_postable)->toBeFalse();
});

// ---- invoices ----

it('imports invoices as priced drafts, one invoice per reference, and never posts them', function (): void {
    $csv = <<<'CSV'
Invoice,Customer,Date,Description,Qty,Price,Tax,Account,Total
INV-A,C1,2026-03-10,Widgets,2,50.00,VAT10,4000,1
INV-A,C1,2026-03-10,Delivery,1,25.00,ZERO,4000,1
INV-B,C1,2026-03-11,Gadget,1,10.00,VAT10,4000,1
INV-B,C1,2026-03-11,Mystery,1,5.00,VAT10,9876,1
INV-C,NOPE,2026-03-12,Thing,1,1.00,,4000,1
CSV;
    $map = ['invoice_ref' => 'Invoice', 'contact' => 'Customer', 'issue_date' => 'Date', 'description' => 'Description', 'quantity' => 'Qty', 'unit_price' => 'Price', 'tax_code' => 'Tax', 'account' => 'Account'];
    $import = $this->previewed('invoices', $csv, $map, by: $this->accountant);

    $rows = $this->rowsOf($import['id'], $this->accountant);
    expect($import['rows_valid'])->toBe(2, 'both rows of INV-A')->and($import['rows_invalid'])->toBe(3)
        ->and($rows[5]['errors'][0]['field'])->toBe('account')->and($rows[5]['errors'][0]['code'])->toBe('code_not_found')
        ->and($rows[4]['errors'][0]['code'])->toBe('invoice_has_errors')->and($rows[4]['errors'][0]['message'])->toContain('row 5')
        ->and($rows[6]['errors'][0]['field'])->toBe('contact');

    $this->requestApply($import['id'], $this->accountant, signing: false)->assertStatus(202);
    $this->runJob($import['id']);

    $invoices = $this->inTenant(fn () => DB::table('invoices')->where('reference', 'like', 'INV-%')->get());
    expect($invoices)->toHaveCount(1)->and($invoices[0]->reference)->toBe('INV-A')->and($invoices[0]->status)->toBe('draft')->and($invoices[0]->journal_id)->toBeNull()
        // 2 × 50.00 + 1 × 25.00 = 125.00 net; 10% VAT on the first line only = 10.00; the file's "Total" column is not a field and is ignored.
        ->and((int) $invoices[0]->subtotal)->toBe(12500)->and((int) $invoices[0]->tax_total)->toBe(1000)->and((int) $invoices[0]->total)->toBe(13500)
        ->and($this->rowCount('journals'))->toBe(0);
    expect($this->rowsOf($import['id'], $this->accountant)[2]['result']['invoice_id'])->toBe($invoices[0]->id);
});

// ---- bank lines ----

it('hands bank lines to the banking importer; a bad row is named and the rest import; the same lines again add nothing', function (): void {
    $csv = <<<'CSV'
Date,Details,Amount,Ref
2026-03-02,ACME LTD payment,"11,000.00",INV-1
2026-03-05,BANK FEE MARCH,-15.00,FEE
2026-02-31,Impossible date,-1.00,X
2026-03-09,Office supplies,-110.00,
CSV;
    $map = ['date' => 'Date', 'description' => 'Details', 'amount' => 'Amount', 'reference' => 'Ref'];
    $options = ['bank_account_id' => $this->bank, 'number_locale' => 'us'];
    $import = $this->previewed('bank_lines', $csv, $map, $options, by: $this->accountant);

    $rows = $this->rowsOf($import['id'], $this->accountant);
    expect($import['rows_valid'])->toBe(3)->and($import['rows_invalid'])->toBe(1)
        ->and($rows[4]['status'])->toBe('invalid')->and($rows[4]['errors'][0]['field'])->toBe('date')
        ->and($import['result']['preview'])->toMatchArray(['lines' => 3, 'money_in' => 1100000, 'money_out' => -12500])
        ->and($this->rowCount('bank_statement_lines'))->toBe(0);

    $this->requestApply($import['id'], $this->accountant, signing: false)->assertStatus(202);
    $this->runJob($import['id']);

    $lines = $this->bankLines();
    expect($lines)->toHaveCount(3)->and($lines['ACME LTD payment']['amount']['amount'])->toBe(1100000)->and($lines['BANK FEE MARCH']['amount']['amount'])->toBe(-1500)
        ->and($lines['Office supplies']['amount']['amount'])->toBe(-11000)->and($this->importOf($import['id'], $this->accountant)['rows_applied'])->toBe(3)
        ->and($this->importOf($import['id'], $this->accountant)['result']['applied']['lines_imported'])->toBe(3);

    // The same three lines in a second import: all skipped by the importer's own dedupe.
    $again = $this->previewed('bank_lines', $csv, $map, $options, by: $this->accountant);
    $this->requestApply($again['id'], $this->accountant, signing: false)->assertStatus(202);
    $this->runJob($again['id']);
    expect($this->rowCount('bank_statement_lines'))->toBe(3)->and($this->rowCount('bank_statements'))->toBe(1)
        ->and($this->importOf($again['id'], $this->accountant)['status'])->toBe('completed');
});

it('takes debit and credit columns and inverted signs for bank lines', function (): void {
    $csv = "Date,Memo,Out,In\n2026-03-02,Rent,1200.50,\n2026-03-03,Deposit,,300.00\n";
    $import = $this->previewed('bank_lines', $csv, ['date' => 'Date', 'description' => 'Memo', 'debit' => 'Out', 'credit' => 'In'], ['bank_account_id' => $this->bank], by: $this->accountant);
    expect($import['rows_valid'])->toBe(2)->and($import['result']['preview'])->toMatchArray(['money_in' => 30000, 'money_out' => -120050]);
});

// ---- opening balances ----

const TB_CSV = <<<'CSV'
Account,Debit,Credit,Party
1000,5000.00,,
1100,1200.00,,C1
2000,,700.00,S1
3000,,5500.00,

CSV;

const TB_MAP = ['account' => 'Account', 'debit' => 'Debit', 'credit' => 'Credit', 'contact' => 'Party'];

it('refuses a trial balance that does not balance, naming the difference, and never plugs retained earnings', function (): void {
    $csv = str_replace('5500.00', '5400.00', TB_CSV);
    $import = $this->previewed('opening_balances', $csv, TB_MAP, ['as_of' => '2026-01-01']);

    // Debits 5,000.00 + 1,200.00 = 620,000; credits 700.00 + 5,400.00 = 610,000.
    expect($import['errors'][0]['code'])->toBe('journal_unbalanced')->and($import['errors'][0]['message'])->toBe('Debits (620000) and credits (610000) differ by 10000.')
        ->and($import['result']['preview'])->toMatchArray(['total_debit' => 620000, 'total_credit' => 610000, 'difference' => 10000]);
    $this->requestApply($import['id'])->assertStatus(422)->assertJsonPath('code', 'import_has_errors');
    expect($this->rowCount('journals'))->toBe(0);
});

it('needs a customer or supplier on receivable and payable lines (the validator rule) and refuses the wrong kind', function (): void {
    $csv = "Account,Debit,Credit,Party\n1000,1200.00,,\n1100,,1200.00,\n";
    $import = $this->previewed('opening_balances', $csv, TB_MAP, ['as_of' => '2026-01-01']);
    $rows = $this->rowsOf($import['id']);
    expect($rows[3]['errors'][0]['code'])->toBe('contact_required')->and($rows[3]['errors'][0]['field'])->toBe('contact');

    $wrong = "Account,Debit,Credit,Party\n1000,1200.00,,\n1100,,1200.00,S1\n";
    $import = $this->previewed('opening_balances', $wrong, TB_MAP, ['as_of' => '2026-01-01']);
    expect($this->rowsOf($import['id'])[3]['errors'][0]['code'])->toBe('contact_kind_mismatch');
});

it('posts one balanced opening journal for a signed owner, and the trial balance shows it', function (): void {
    $import = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);
    expect($import['rows_valid'])->toBe(4)->and($import['errors'])->toBe([])->and($import['all_or_nothing'])->toBeTrue()->and($import['needs_signature'])->toBeTrue()
        ->and($import['result']['preview'])->toMatchArray(['total_debit' => 620000, 'total_credit' => 620000, 'difference' => 0]);

    // No signing grant at request time: refused, nothing queued.
    $this->requestApply($import['id'], signing: false)->assertStatus(403)->assertJsonPath('code', 'signature_required');
    expect($this->importOf($import['id'])['status'])->toBe('previewed');

    $queued = $this->requestApply($import['id'])->assertStatus(202)->json('data');
    expect($queued['signed_by'])->toBe($this->owner->id)->and($queued['requested_by'])->toBe($this->owner->id)->and($queued['signed_at'])->not->toBeNull();
    expect($this->rowCount('journals'))->toBe(0);
    $this->runJob($import['id']);

    $done = $this->importOf($import['id']);
    expect($done['status'])->toBe('completed')->and($done['rows_applied'])->toBe(4);
    $journals = $this->inTenant(fn () => DB::table('journals')->get());
    expect($journals)->toHaveCount(1)->and($journals[0]->journal_type)->toBe('opening')->and($journals[0]->status)->toBe('posted')
        ->and($journals[0]->journal_date)->toBe('2026-01-01')->and((int) $journals[0]->total_debit)->toBe(620000)->and((int) $journals[0]->total_credit)->toBe(620000)
        ->and($journals[0]->posted_by)->toBe($this->owner->id)->and($journals[0]->source_type)->toBe('import')->and($journals[0]->source_id)->toBe($import['id'])
        ->and($done['result']['applied']['journal_id'])->toBe($journals[0]->id);
    $lines = $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $journals[0]->id)->get());
    expect($lines)->toHaveCount(4)->and($lines->where('contact_id', $this->t->customer)->count())->toBe(1)->and($lines->where('contact_id', $this->t->supplier)->count())->toBe(1);

    $tb = $this->asPerson($this->owner)->getJson($this->api('reports/trial-balance?as_of=2026-01-31'))->assertOk();
    $byCode = collect($tb->json('data.rows'))->keyBy('account.code');
    expect($tb->json('data.balanced'))->toBeTrue()->and($tb->json('data.totals.debit.amount'))->toBe(620000)->and($tb->json('data.totals.credit.amount'))->toBe(620000)
        ->and($byCode['1000']['debit']['amount'])->toBe(500000)->and($byCode['1100']['debit']['amount'])->toBe(120000)
        ->and($byCode['2000']['credit']['amount'])->toBe(70000)->and($byCode['3000']['credit']['amount'])->toBe(550000);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));

    // Running the job again, or asking again, posts nothing more.
    $this->runJob($import['id']);
    $this->requestApply($import['id'])->assertOk();
    expect($this->rowCount('journals'))->toBe(1);
});

it('allows one opening journal per company until it is reversed', function (): void {
    $first = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);
    $this->requestApply($first['id'])->assertStatus(202);
    $this->runJob($first['id']);
    $journal = $this->inTenant(fn () => DB::table('journals')->value('id'));

    $second = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);
    expect($second['errors'][0]['code'])->toBe('opening_balances_exist');
    $this->requestApply($second['id'])->assertStatus(422)->assertJsonPath('code', 'import_has_errors');

    // The database refuses a second posted opening journal even if every check were bypassed.
    expect(fn () => $this->inTenant(fn () => DB::table('journals')->where('id', $journal)->first() !== null && DB::statement(
        "INSERT INTO journals (id, tenant_id, company_id, journal_type, status, journal_date, fiscal_period_id, number, total_debit, total_credit) SELECT gen_random_uuid(), tenant_id, company_id, 'opening', 'posted', journal_date, fiscal_period_id, 'JV-X-1', 0, 0 FROM journals WHERE id = ?", [$journal],
    )))->toThrow(QueryException::class);

    // Reverse it (a signed owner), and a fresh import posts.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$journal}/reverse"), [], $this->key())->assertCreated();
    $third = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);
    expect($third['errors'])->toBe([]);
    $this->requestApply($third['id'])->assertStatus(202);
    $this->runJob($third['id']);
    expect($this->importOf($third['id'])['status'])->toBe('completed')
        ->and($this->inTenant(fn () => DB::table('journals')->where('journal_type', 'opening')->where('status', 'posted')->count()))->toBe(1);
});

it('refuses opening balances dated in a closed period', function (): void {
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-01-15', 'closed'));
    $import = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);

    expect(array_column($import['errors'], 'code'))->toContain('period_closed');
    $this->requestApply($import['id'])->assertStatus(422)->assertJsonPath('code', 'import_has_errors');
    expect($this->rowCount('journals'))->toBe(0);
});

it('fails the whole import, posting nothing, when the world changed after the preview', function (): void {
    $import = $this->previewed('opening_balances', TB_CSV, TB_MAP, ['as_of' => '2026-01-01']);
    $this->requestApply($import['id'])->assertStatus(202);
    // The period closes between the request and the job.
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-01-15', 'closed'));
    $this->runJob($import['id']);

    $done = $this->importOf($import['id']);
    expect($done['status'])->toBe('failed')->and($done['rows_applied'])->toBe(0)->and($done['rows_failed'])->toBe(4)->and($this->rowCount('journals'))->toBe(0);
});

it('needs settings.manage: an accountant cannot import opening balances, a token cannot import anything', function (): void {
    $this->upload('opening_balances', TB_CSV, ['as_of' => '2026-01-01'], by: $this->accountant)->assertForbidden();
    $this->upload('accounts', "Code,Name,Type\n1,A,asset\n", by: $this->accountant)->assertForbidden();
    $this->upload('invoices', "x\n1\n", by: $this->assistant)->assertCreated(); // the Sales Assistant holds invoices.create
    $this->upload('contacts', CONTACTS_CSV, by: $this->assistant)->assertForbidden(); // but not contacts.manage (only manage_customers)

    $token = $this->newToken(['contacts:write', 'banking:write', 'invoices:write', 'accounts:write']);
    $this->asToken($token)->post($this->api('imports'), ['kind' => 'contacts', 'file' => UploadedFile::fake()->createWithContent('c.csv', CONTACTS_CSV)], $this->key())->assertForbidden();
    $this->asToken($token)->getJson($this->api('imports'))->assertForbidden();
});

it('lets a person list only what their permissions cover', function (): void {
    $this->upload('contacts', CONTACTS_CSV)->assertCreated();
    $this->upload('opening_balances', TB_CSV, ['as_of' => '2026-01-01'])->assertCreated();
    $seen = $this->asPerson($this->accountant)->getJson($this->api('imports'))->assertOk()->json('data');
    // The accountant holds contacts.manage but not settings.manage: the contacts import is listed, the opening one is neither listed nor readable.
    expect(array_column($seen, 'kind'))->toBe(['contacts']);
    $opening = $this->asPerson($this->owner)->getJson($this->api('imports?kind=opening_balances'))->assertOk()->json('data.0');
    $this->asPerson($this->accountant)->getJson($this->api("imports/{$opening['id']}"))->assertForbidden();
});

// ---- files ----

it('reads an XLSX and echoes cells so a spreadsheet will not run them', function (): void {
    $bytes = $this->xlsx([['Code', 'Name', 'Terms'], ['X-1', '=HYPERLINK("http://evil.example","click")', '30'], ['X-2', '+1+1', '-12.50'], ['X-3', '@SUM(1)', '15']]);
    $r = $this->upload('contacts', $bytes, name: 'people.xlsx')->assertCreated();
    expect($r->json('data.source_format'))->toBe('xlsx')->and($r->json('data.rows_total'))->toBe(3);

    $rows = $this->rowsOf($r->json('data.id'));
    expect($rows[2]['cells']['Name'])->toBe("'=HYPERLINK(\"http://evil.example\",\"click\")")->and($rows[3]['cells']['Name'])->toBe("'+1+1")->and($rows[3]['cells']['Terms'])->toBe('-12.50')
        ->and($rows[4]['cells']['Name'])->toBe("'@SUM(1)")->and($rows[2]['cells']['Terms'])->toBe('30');
    // The stored cell is exactly what was uploaded.
    $stored = $this->inTenant(fn () => DB::table('import_rows')->where('import_id', $r->json('data.id'))->where('row_number', 2)->value('cells'));
    expect(json_decode((string) $stored, true)['Name'])->toBe('=HYPERLINK("http://evil.example","click")');
});

it('echoes a CSV injection cell safely too, and keeps imported text exactly as uploaded', function (): void {
    $csv = "Code,Name\nI-1,\"=CMD|' /C calc'!A0\"\n";
    $import = $this->previewed('contacts', $csv, ['code' => 'Code', 'name' => 'Name']);
    expect($this->rowsOf($import['id'])[2]['cells']['Name'])->toBe("'=CMD|' /C calc'!A0");
});

it('refuses files it cannot read, oversize files, too many rows and the wrong type', function (): void {
    // A zip signature followed by rubbish; and a name that lies about the content.
    $this->upload('contacts', "PK\x03\x04".random_bytes(200), name: 'broken.xlsx')->assertStatus(422)->assertJsonPath('code', 'import_file_unreadable');
    $this->upload('contacts', "PK\x03\x04".random_bytes(200), name: 'x.csv')->assertStatus(422)->assertJsonPath('code', 'import_file_unreadable');
    $this->upload('contacts', "Code,Name\n", name: 'empty.csv')->assertStatus(422)->assertJsonPath('code', 'import_file_empty');
    $this->upload('contacts', "Code,Name\nA,B\n", name: 'run.exe')->assertStatus(422)->assertJsonPath('code', 'import_file_unreadable');
    $this->upload('contacts', "Code,Code\nA,B\n")->assertStatus(422)->assertJsonPath('code', 'import_duplicate_header');
    $this->upload('contacts', "Code,Name\nA,B,C\n")->assertStatus(422)->assertJsonPath('code', 'import_malformed_row');

    config(['imports.max_rows' => 3]);
    $this->upload('contacts', "Code,Name\n1,a\n2,b\n3,c\n4,d\n")->assertStatus(422)->assertJsonPath('code', 'import_too_many_rows');
    $this->upload('contacts', "Code,Name\n1,a\n2,b\n3,c\n")->assertCreated();

    config(['imports.max_bytes' => 2048]);
    $big = "Code,Name\n".str_repeat('X,'.str_repeat('n', 100)."\n", 40);
    $this->upload('contacts', $big)->assertStatus(422)->assertJsonValidationErrors('file');
    expect($this->rowCount('imports'))->toBe(1);
});

it('reads CSV with semicolons, a BOM and the eu number format', function (): void {
    $csv = "\xEF\xBB\xBFDatum;Text;Betrag\n02.03.2026;Miete;-1.200,50\n";
    $import = $this->previewed('bank_lines', $csv, ['date' => 'Datum', 'description' => 'Text', 'amount' => 'Betrag'], ['bank_account_id' => $this->bank, 'number_locale' => 'eu', 'date_format' => 'd.m.Y'], by: $this->accountant);
    expect($import['rows_valid'])->toBe(1)->and($import['result']['preview'])->toMatchArray(['money_out' => -120050]);
});

// ---- retention ----

it('purges the cells of an import but keeps its history, and a purged import cannot be applied', function (): void {
    $import = $this->previewed('contacts', CONTACTS_CSV, CONTACT_MAP);
    $this->asPerson($this->owner)->postJson($this->api("imports/{$import['id']}/purge"), [], $this->key())->assertOk()->assertJsonPath('data.rows_purged_at', fn ($v) => $v !== null);

    $rows = $this->rowsOf($import['id']);
    expect($rows[2]['cells'])->toBe([])->and($rows[4]['status'])->toBe('invalid')->and($rows[4]['errors'][0]['field'])->toBe('name');
    $this->requestApply($import['id'])->assertStatus(409)->assertJsonPath('code', 'import_purged');
    $this->asPerson($this->owner)->postJson($this->api("imports/{$import['id']}/preview"), [], $this->key())->assertStatus(409);

    // Not while queued.
    $other = $this->previewed('contacts', "Code,Name\nQ-1,Q\n", ['code' => 'Code', 'name' => 'Name']);
    $this->requestApply($other['id'])->assertStatus(202);
    $this->asPerson($this->owner)->postJson($this->api("imports/{$other['id']}/purge"), [], $this->key())->assertStatus(409)->assertJsonPath('code', 'import_state_invalid');
});

it('lists the kinds with their fields', function (): void {
    $kinds = $this->asPerson($this->owner)->getJson($this->api('imports/kinds'))->assertOk()->json('data');
    $byKind = array_column($kinds, null, 'kind');
    expect(array_keys($byKind))->toBe(['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines'])
        ->and($byKind['opening_balances']['permission'])->toBe('settings.manage')->and($byKind['opening_balances']['all_or_nothing'])->toBeTrue()
        ->and($byKind['contacts']['permission'])->toBe('contacts.manage')->and($byKind['invoices']['permission'])->toBe('invoices.create')
        ->and($byKind['bank_lines']['permission'])->toBe('banking.reconcile')->and($byKind['accounts']['permission'])->toBe('accounts.manage');
});
