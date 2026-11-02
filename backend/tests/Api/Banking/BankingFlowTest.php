<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\BankingApi;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/*
 * Banking (plan 2.13). Statement March: +11,000.00 (INV-1), -15.00 (bank fee), -110.00 (office supplies) = 1,087,500 minor units from an
 * opening balance of 0. The sale is 1,000,000 + 10% VAT = 1,100,000.
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
});

it('imports a CSV statement: three lines, balances 0 → 1,087,500, no warnings; the same file again adds nothing', function (): void {
    $r = $this->importStatement()->assertCreated();

    expect($r->json('data.lines_imported'))->toBe(3)->and($r->json('data.duplicate_lines_skipped'))->toBe(0)->and($r->json('data.warnings'))->toBe([])
        ->and($r->json('data.statement.opening_balance.amount'))->toBe(0)->and($r->json('data.statement.closing_balance.amount'))->toBe(1087500)
        ->and($r->json('data.statement.period_from'))->toBe('2026-03-02');
    $lines = $this->bankLines();
    expect($lines['BANK FEE MARCH']['amount']['amount'])->toBe(-1500)->and($lines['ACME LTD payment']['amount']['amount'])->toBe(1100000)
        ->and($lines['Office supplies']['status'])->toBe('unmatched');

    $again = $this->importStatement()->assertOk();
    expect($again->json('data.already_imported'))->toBeTrue()->and($again->json('data.lines_imported'))->toBe(0)->and($again->json('data.duplicate_lines_skipped'))->toBe(3);
    // A different file with the same three lines (CAMT) adds no line and no statement either.
    $camt = $this->importStatement('march_camt053.xml')->assertOk();
    expect($camt->json('data.lines_imported'))->toBe(0)->and($camt->json('data.duplicate_lines_skipped'))->toBe(3)->and($camt->json('data.statement'))->toBeNull();
    $this->inTenant(fn () => expect(DB::table('bank_statement_lines')->count())->toBe(3)->and(DB::table('bank_statements')->count())->toBe(1));
});

it('imports OFX 1.x, OFX 2.x and CAMT.053 files into the same lines', function (string $file, ?int $opening): void {
    $r = $this->importStatement($file)->assertCreated();

    expect($r->json('data.lines_imported'))->toBe(3)->and($r->json('data.statement.closing_balance.amount'))->toBe(1087500)->and($r->json('data.statement.opening_balance.amount'))->toBe($opening);
    // OFX states only the closing balance: without a previous statement the balance check cannot run.
    expect($r->json('data.warnings'))->toBe($opening === null ? ['balances_not_provided'] : []);
})->with([['march.ofx', null], ['march_v2.ofx', null], ['march_camt053.xml', 0]]);

it('uses the previous statement closing balance as the opening of an OFX statement, and checks it', function (): void {
    $this->importStatement()->assertCreated();
    $ofx = str_replace(['20260302120000', '20260305', '20260309', '20260301', '20260331'], ['20260402120000', '20260405', '20260409', '20260401', '20260430'], (string) file_get_contents(__DIR__.'/../../fixtures/bank/march.ofx'));
    $r = $this->importStatement('april.ofx', [], null, $ofx)->assertCreated();

    // April lines are another three (other dates); opening = March closing 1,087,500, closing 10,875.00?? no: closing stays 1,087,500 → mismatch warning
    expect($r->json('data.statement.opening_balance.amount'))->toBe(1087500)->and($r->json('data.warnings'))->toContain('opening_balance_from_previous_statement', 'statement_balance_mismatch');
});

it('refuses bad files with line numbers, a DOCTYPE, oversize files and a missing mapping', function (): void {
    $bad = $this->importStatement('bad_lines.csv', ['mapping' => json_encode(['columns' => ['date' => 'Date', 'description' => 'Description', 'amount' => 'Amount']])])->assertUnprocessable();
    expect($bad->json('code'))->toBe('statement_malformed')->and(array_column($bad->json('violations'), 'line_no'))->toBe([3, 4]);

    $this->importStatement('xxe_camt053.xml')->assertUnprocessable()->assertJsonPath('code', 'statement_malformed');
    $this->importStatement('march_us.csv', ['mapping' => ''])->assertUnprocessable()->assertJsonPath('code', 'mapping_required');
    $this->importStatement('big.csv', [], null, str_repeat('a', 2_200_000))->assertUnprocessable();
    $this->inTenant(fn () => expect(DB::table('bank_statement_lines')->count())->toBe(0));
});

it('saves the CSV mapping with the account and reuses it', function (): void {
    $this->importStatement('march_us.csv', ['save_mapping' => true])->assertCreated();
    $saved = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}"))->assertOk()->json('data.import_mapping');
    expect($saved['locale'])->toBe('us');

    $next = "Date,Description,Reference,Amount,Balance\n2026-04-02,Interest,INT-1,1.00,\"10,876.00\"\n";
    $this->importStatement('april.csv', [], null, $next)->assertCreated()->assertJsonPath('data.lines_imported', 1);
});

it('suggests a settlement by exact amount, reference and date, then matches it; a line matches once', function (): void {
    $this->sale(1000000, '2026-03-01');
    $receipt = $this->bankReceipt(1100000, '2026-03-02', 'INV-1');
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['ACME LTD payment'];

    $s = $this->asPerson($this->accountant)->getJson($this->api("bank-statement-lines/{$line['id']}/suggestions"))->assertOk()->json('data');
    expect($s['matches'])->toHaveCount(1)->and($s['matches'][0]['settlement_id'])->toBe($receipt['id'])->and($s['matches'][0]['amount'])->toBe(1100000)
        ->and($s['matches'][0]['explanation'])->toBe(['exact_amount', 'reference_match', 'same_day'])->and($s['matches'][0]['score'])->toBe(100)->and($s['rule'])->toBeNull();

    $m = $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line['id']], 'settlement_ids' => [$receipt['id']]], $this->key())->assertCreated();
    expect($m->json('data.amount.amount'))->toBe(1100000)->and($m->json('data.settlement_ids'))->toBe([$receipt['id']]);
    expect($this->bankLines()['ACME LTD payment']['status'])->toBe('matched')->and($this->bankLines()['ACME LTD payment']['match_id'])->toBe($m->json('data.id'));

    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line['id']], 'settlement_ids' => [$receipt['id']]], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'line_already_matched');
    $this->asPerson($this->accountant)->getJson($this->api("bank-statement-lines/{$line['id']}/suggestions"))->assertJsonPath('data.matches', []);

    $this->asPerson($this->accountant)->deleteJson($this->api('bank-matches/'.$m->json('data.id')), [], $this->key())->assertNoContent();
    expect($this->bankLines()['ACME LTD payment']['status'])->toBe('unmatched');
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('matches many statement lines to one book line and one line to many, only when the sums are exact', function (): void {
    // Book: one receipt of 1,000.00 (100000) and two of 400.00 + 600.00. Statement: 300.00 + 700.00, and 1,000.00.
    $one = $this->bankReceipt(100000, '2026-04-02', 'R1');
    $a = $this->bankReceipt(40000, '2026-04-03', 'R2');
    $b = $this->bankReceipt(60000, '2026-04-03', 'R3');
    $csv = "Date,Description,Reference,Amount\n2026-04-02,part one,P1,300.00\n2026-04-02,part two,P2,700.00\n2026-04-03,lump,L1,1000.00\n";
    $this->importStatement('april.csv', ['mapping' => json_encode(['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']])], null, $csv)->assertCreated();
    $lines = $this->bankLines();

    $post = fn (array $body) => $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), $body, $this->key());
    // 300 + 700 ≠ 400 → refused; 300 + 700 = 1,000 → ok (many-to-one).
    $post(['statement_line_ids' => [$lines['part one']['id'], $lines['part two']['id']], 'settlement_ids' => [$a['id']]])->assertUnprocessable()->assertJsonPath('code', 'match_amount_mismatch');
    $post(['statement_line_ids' => [$lines['part one']['id'], $lines['part two']['id']], 'settlement_ids' => [$one['id']]])->assertCreated();
    // 1,000 against 400 + 600 (one-to-many).
    $post(['statement_line_ids' => [$lines['lump']['id']], 'settlement_ids' => [$a['id'], $b['id']]])->assertCreated()->assertJsonPath('data.amount.amount', 100000);
    $post(['statement_line_ids' => [$lines['lump']['id']], 'settlement_ids' => [$one['id']]])->assertUnprocessable();
});

it('refuses lines of another bank account or company and a book line of another account', function (): void {
    $other = $this->secondCompany();
    $both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($both->id, $other->id, 'Owner')));
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['BANK FEE MARCH'];

    // A statement line id of this company used under company B is not found there (404 on the bound path, 422 in the body).
    $this->asPerson($both)->getJson($this->api("bank-accounts/{$this->bank}", $other->id))->assertNotFound();
    $this->asPerson($both)->getJson($this->api("bank-statement-lines/{$line['id']}/suggestions", $other->id))->assertNotFound();
    $this->asPerson($both)->postJson($this->api('bank-matches', $other->id), ['statement_line_ids' => [$line['id']], 'journal_line_ids' => [$line['id']]], $this->key())->assertUnprocessable();
    $this->asPerson($both)->deleteJson($this->api('bank-matches/'.(string) Str::uuid(), $other->id), [], $this->key())->assertNotFound();
    // Foreign ids in the body of this company are a validation error.
    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line['id']], 'journal_line_ids' => [(string) Str::uuid()]], $this->key())->assertUnprocessable();
    $cash = $this->postedSettlement('receipt', $this->t->customer, 1500, [], '2026-03-05', '1000');
    $jl = $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $cash['journal_id'])->where('account_id', $this->f->account('1000'))->value('id'));
    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line['id']], 'journal_line_ids' => [$jl]], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'book_line_not_on_account');
});

it('codes a bank fee as spend money: Dr expense 1,500, Cr bank 1,500, dated the line, line matched; a signing grant is needed', function (): void {
    $this->importStatement()->assertCreated();
    $fee = $this->bankLines()['BANK FEE MARCH'];
    $body = ['kind' => 'spend', 'account_id' => $this->f->account('6300')];

    $this->asPerson($this->accountant)->postJson($this->api("bank-statement-lines/{$fee['id']}/transactions"), $body, $this->key())->assertForbidden()->assertJsonPath('code', 'signature_required');
    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$fee['id']}/transactions"), $body, $this->key())->assertCreated();

    expect($t->json('data.status'))->toBe('posted')->and($t->json('data.gross.amount'))->toBe(1500);
    $j = $this->document('journals', $t->json('data.journal_id'));
    expect($j['journal_type'])->toBe('bank')->and($j['journal_date'])->toBe('2026-03-05')->and($j['source_type'])->toBe('bank_transaction')
        ->and($this->t->journalOf($j['id']))->toBe(['6300' => ['debit' => 1500, 'credit' => 0], '1010' => ['debit' => 0, 'credit' => 1500]]);
    expect($this->bankLines()['BANK FEE MARCH']['status'])->toBe('matched');
    // The same line cannot be coded twice.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$fee['id']}/transactions"), $body, $this->key())->assertUnprocessable()->assertJsonPath('code', 'line_not_open');
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('splits VAT out of the gross: 110.00 with 10% VAT is net 100.00 and tax 10.00 (HALF_UP)', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['Office supplies'];
    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), [
        'kind' => 'spend', 'account_id' => $this->f->account('5000'), 'tax_code_id' => $this->t->tax['VAT10'], 'memo' => 'Paper',
    ], $this->key())->assertCreated();

    expect($this->t->journalOf($t->json('data.journal_id')))->toBe([
        '5000' => ['debit' => 10000, 'credit' => 0], '2110' => ['debit' => 1000, 'credit' => 0], '1010' => ['debit' => 0, 'credit' => 11000],
    ]);
});

it('puts irrecoverable VAT into the expense (IAS 2.11): 110.00 with non-recoverable 10% is Dr expense 110.00', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['Office supplies'];
    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), [
        'kind' => 'spend', 'account_id' => $this->f->account('5000'), 'tax_code_id' => $this->t->tax['VATNR'],
    ], $this->key())->assertCreated();

    expect($this->t->journalOf($t->json('data.journal_id')))->toBe(['5000' => ['debit' => 11000, 'credit' => 0], '1010' => ['debit' => 0, 'credit' => 11000]]);
});

it('receives money with output VAT: 11,000.00 in is Cr sales 10,000.00 net and Cr VAT output 1,000.00', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['ACME LTD payment'];
    // 1,100,000 gross at 10%: net 1,000,000 and tax 100,000.
    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), [
        'kind' => 'receive', 'account_id' => $this->f->account('4000'), 'tax_code_id' => $this->t->tax['VAT10'],
    ], $this->key())->assertCreated();

    expect($this->t->journalOf($t->json('data.journal_id')))->toEqual(['1010' => ['debit' => 1100000, 'credit' => 0], '4000' => ['debit' => 0, 'credit' => 1000000], '2100' => ['debit' => 0, 'credit' => 100000]]);
});

it('refuses control accounts, the wrong direction and a transfer to the same account or another currency', function (): void {
    $this->importStatement()->assertCreated();
    $fee = $this->bankLines()['BANK FEE MARCH'];
    $in = $this->bankLines()['ACME LTD payment'];
    $go = fn (string $id, array $body) => $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$id}/transactions"), $body, $this->key());

    $go($fee['id'], ['kind' => 'spend', 'account_id' => $this->f->account('1100')])->assertUnprocessable()->assertJsonPath('code', 'control_account_not_allowed');
    $go($fee['id'], ['kind' => 'spend', 'account_id' => $this->f->account('2110')])->assertUnprocessable()->assertJsonPath('code', 'control_account_not_allowed');
    $go($fee['id'], ['kind' => 'spend', 'account_id' => $this->f->account('1010')])->assertUnprocessable()->assertJsonPath('code', 'control_account_not_allowed');
    $go($fee['id'], ['kind' => 'receive', 'account_id' => $this->f->account('4000')])->assertUnprocessable()->assertJsonPath('code', 'direction_mismatch');
    $go($in['id'], ['kind' => 'spend', 'account_id' => $this->f->account('5000')])->assertUnprocessable()->assertJsonPath('code', 'direction_mismatch');
    $go($fee['id'], ['kind' => 'transfer', 'to_bank_account_id' => $this->bank])->assertUnprocessable()->assertJsonPath('code', 'transfer_account_invalid');

    $eur = $this->asPerson($this->owner)->postJson($this->api('bank-accounts'), ['name' => 'Euro', 'account_id' => $this->f->account('1200'), 'currency' => 'EUR'], $this->key())->assertCreated()->json('data.id');
    $go($fee['id'], ['kind' => 'transfer', 'to_bank_account_id' => $eur])->assertUnprocessable()->assertJsonPath('code', 'transfer_currency_mismatch');
    expect($this->bankLines()['BANK FEE MARCH']['status'])->toBe('unmatched');
});

it('transfers between own banks of one currency: money out is Dr destination, Cr source', function (): void {
    $this->f->accounts['1011'] = (string) Str::uuid7();
    $this->inTenant(fn () => DB::table('accounts')->insert(['id' => $this->f->accounts['1011'], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => '1011', 'name' => 'Savings', 'account_type' => 'asset', 'normal_balance' => 'debit', 'control_type' => 'bank', 'currency_policy' => 'base_only']));
    $savings = $this->asPerson($this->owner)->postJson($this->api('bank-accounts'), ['name' => 'Savings', 'account_id' => $this->f->account('1011'), 'currency' => 'USD'], $this->key())->assertCreated()->json('data.id');
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['Office supplies'];

    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), ['kind' => 'transfer', 'to_bank_account_id' => $savings], $this->key())->assertCreated();

    expect($this->t->journalOf($t->json('data.journal_id')))->toBe(['1011' => ['debit' => 11000, 'credit' => 0], '1010' => ['debit' => 0, 'credit' => 11000]]);
});

it('keeps threshold and workflows consistent: above the threshold it waits for an approver, matches on approval, maker ≠ checker', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['Office supplies'];
    $this->inTenant(fn () => DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['approval_defaults' => json_encode(['journal_threshold' => 5000])]));
    $body = ['kind' => 'spend', 'account_id' => $this->f->account('5000')];

    // 11,000 > 5,000 and no journal workflow covers it: refused rather than posted unapproved.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), $body, $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'approval_workflow_missing');
    expect($this->bankLines()['Office supplies']['status'])->toBe('unmatched');

    $this->workflow('journal');
    $t = $this->asPerson($this->owner)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), $body, $this->key())->assertCreated();
    $journalId = $t->json('data.journal_id');
    expect($t->json('data.status'))->toBe('pending_approval')->and($this->bankLines()['Office supplies']['pending_journal_id'])->toBe($journalId)
        ->and($this->bankLines()['Office supplies']['status'])->toBe('unmatched');
    // A line waiting for approval cannot be matched by hand or coded again.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), $body, $this->key())->assertUnprocessable()->assertJsonPath('code', 'line_not_open');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$journalId}/approve"), [], $this->key())->assertForbidden(); // the policy refuses the maker before the Action (which also refuses: self_approval_forbidden)
    $this->asPerson($this->approver, signing: true)->postJson($this->api("journals/{$journalId}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    expect($this->bankLines()['Office supplies']['status'])->toBe('matched')->and($this->bankLines()['Office supplies']['pending_journal_id'])->toBeNull();
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('posts at the threshold itself: a bank transaction of exactly the threshold does not need approval', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['Office supplies'];
    $this->inTenant(fn () => DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['approval_defaults' => json_encode(['journal_threshold' => 11000])]));

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('5000')], $this->key())
        ->assertCreated()->assertJsonPath('data.status', 'posted');
});

it('refuses a closed period for a bank transaction (the period of the line date)', function (): void {
    $this->importStatement()->assertCreated();
    $line = $this->bankLines()['BANK FEE MARCH'];
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-03-05', 'closed'));

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('6300')], $this->key())
        ->assertUnprocessable();
    expect($this->bankLines()['BANK FEE MARCH']['status'])->toBe('unmatched');
});

it('manages rules: first match by priority, reorder, apply a rule to code the line with its VAT', function (): void {
    $this->importStatement()->assertCreated();
    $rule = fn (string $name, string $contains, string $direction, int $account = 6300, ?string $tax = null) => $this->asPerson($this->accountant)->postJson($this->api('bank-rules'), [
        'name' => $name, 'conditions' => ['contains' => $contains, 'direction' => $direction], 'action' => ['account_id' => $this->f->account((string) $account), 'tax_code_id' => $tax, 'memo' => $name],
    ], $this->key());
    $fees = $rule('Bank fees', 'fee', 'out')->assertCreated();
    $any = $rule('Anything March', 'march', 'any', 5000)->assertCreated();
    expect($fees->json('data.priority'))->toBe(1)->and($any->json('data.priority'))->toBe(2);

    $line = $this->bankLines()['BANK FEE MARCH'];
    // Both match "BANK FEE MARCH": rule 1 wins.
    $s = $this->asPerson($this->accountant)->getJson($this->api("bank-statement-lines/{$line['id']}/suggestions"))->json('data');
    expect($s['rule']['name'])->toBe('Bank fees');
    $this->asPerson($this->accountant)->putJson($this->api('bank-rules/order'), ['ids' => [$any->json('data.id'), $fees->json('data.id')]], $this->key())->assertOk()->assertJsonPath('data.0.name', 'Anything March');
    expect($this->asPerson($this->accountant)->getJson($this->api("bank-statement-lines/{$line['id']}/suggestions"))->json('data.rule.name'))->toBe('Anything March');
    $this->asPerson($this->accountant)->putJson($this->api('bank-rules/order'), ['ids' => [$any->json('data.id')]], $this->key())->assertUnprocessable()->assertJsonPath('code', 'rule_order_invalid');

    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/apply-rule"), ['rule_id' => $fees->json('data.id')], $this->key())->assertCreated();
    expect($t->json('data.rule_id'))->toBe($fees->json('data.id'))->and($this->t->journalOf($t->json('data.journal_id')))->toBe(['6300' => ['debit' => 1500, 'credit' => 0], '1010' => ['debit' => 0, 'credit' => 1500]]);
    expect($this->asPerson($this->owner)->getJson($this->api('bank-rules'))->json('data.1.times_applied'))->toBe(1);
    $this->asPerson($this->accountant, signing: true)->postJson($this->api('bank-statement-lines/'.$this->bankLines()['Office supplies']['id'].'/apply-rule'), ['rule_id' => $fees->json('data.id')], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'rule_not_applicable');
    $this->asPerson($this->accountant)->deleteJson($this->api('bank-rules/'.$any->json('data.id')), [], $this->key())->assertNoContent();
});

it('rejects rules that code to control accounts, empty text and an inverted amount range', function (): void {
    $bad = fn (array $c, int $acc = 6300) => $this->asPerson($this->accountant)->postJson($this->api('bank-rules'), ['name' => 'r', 'conditions' => $c, 'action' => ['account_id' => $this->f->account((string) $acc)]], $this->key());
    $bad(['contains' => 'x', 'direction' => 'any'], 1100)->assertUnprocessable()->assertJsonPath('code', 'control_account_not_allowed');
    $bad(['contains' => '  ', 'direction' => 'any'])->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
    $bad(['contains' => 'x', 'direction' => 'any', 'min_amount' => 500, 'max_amount' => 100])->assertUnprocessable()->assertJsonPath('code', 'rule_condition_invalid');
});

it('reconciles: live difference 0, finish freezes matches, unmatch and reversal are refused until reopened, then allowed', function (): void {
    $this->sale(1000000, '2026-03-01');
    $receipt = $this->bankReceipt(1100000, '2026-03-02', 'INV-1');
    $this->importStatement()->assertCreated();
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $lines = $this->bankLines();
    $matched = $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$lines['ACME LTD payment']['id']], 'settlement_ids' => [$receipt['id']]], $this->key())->assertCreated();
    $fee = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$lines['BANK FEE MARCH']['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('6300')], $this->key())->assertCreated();
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$lines['Office supplies']['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('5000')], $this->key())->assertCreated();

    $rec = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertCreated();
    $report = $rec->json('data.report');
    // Book: +1,100,000 − 1,500 − 11,000 = 1,087,500, all matched: opening position 0, unmatched 0, difference 0.
    expect($rec->json('data.status'))->toBe('in_progress')->and($report['book']['balance'])->toBe(1087500)->and($report['book']['matched'])->toBe(1087500)
        ->and($report['book']['unmatched'])->toBe(0)->and($report['unmatched_statement']['total'])->toBe(0)->and($report['difference'])->toBe(0)
        ->and($report['statement']['receipts'])->toBe(1100000)->and($report['statement']['payments'])->toBe(-12500);

    $done = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $this->key())->assertOk();
    expect($done->json('data.status'))->toBe('finished')->and($done->json('data.difference'))->toBe(0)->and($done->json('data.book_balance'))->toBe(1087500)->and($done->json('data.statement_balance'))->toBe(1087500);

    $this->asPerson($this->accountant)->deleteJson($this->api('bank-matches/'.$matched->json('data.id')), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'reconciliation_finished');
    $this->asPerson($this->owner, signing: true)->postJson($this->api('journals/'.$fee->json('data.journal_id').'/reverse'), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'journal_in_finished_reconciliation');
    $this->asPerson($this->owner, signing: true)->postJson($this->api('settlements/'.$receipt['id'].'/reverse'), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'journal_in_finished_reconciliation');
    $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'reconciliation_finished');
    $this->inTenant(function () use ($rec): void {
        expect(fn () => DB::table('bank_reconciliations')->where('id', $rec->json('data.id'))->update(['as_of' => '2026-01-01']))->toThrow(PDOException::class, 'LG020');
        expect(fn () => DB::table('bank_matches')->delete())->toThrow(PDOException::class, 'LG021');
        expect(LedgerChecks::problems())->toBe([]);
    });

    $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/reopen'), ['reason' => ' '], $this->key())->assertUnprocessable();
    $re = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/reopen'), ['reason' => 'Wrong fee account'], $this->key())->assertOk();
    expect($re->json('data.status'))->toBe('in_progress')->and($re->json('data.reopen_reason'))->toBe('Wrong fee account')->and($re->json('data.reopen_count'))->toBe(1);
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'bank_reconciliation.reopened')->count())->toBe(1));

    $this->asPerson($this->owner, signing: true)->postJson($this->api('journals/'.$fee->json('data.journal_id').'/reverse'), [], $this->key())->assertSuccessful();
    $this->asPerson($this->accountant)->deleteJson($this->api('bank-matches/'.$matched->json('data.id')), [], $this->key())->assertNoContent();
    // After the reversal the books hold the fee and its mirror (both unmatched outstanding items net to 0): still reconcilable.
    $live = $this->asPerson($this->accountant)->getJson($this->api('bank-reconciliations/'.$rec->json('data.id')))->json('data.report');
    expect($live['difference'])->toBe(0)->and($live['unmatched_statement']['total'])->toBe(1100000 - 1500 * 0);
});

it('refuses to finish while a statement line is not in the books, however small the difference', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->bankReceipt(1100000, '2026-03-02', 'INV-1');
    $this->importStatement()->assertCreated();
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $rec = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertCreated();

    // Nothing matched: the difference is already zero, and that must not be enough.
    expect($rec->json('data.report.difference'))->toBe(0);
    $this->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $this->key())
        ->assertUnprocessable()->assertJson(['code' => 'reconciliation_lines_unmatched']);

    // The list of an account's reconciliations reads without the live report.
    $this->getJson($this->api("bank-accounts/{$this->bank}/reconciliations"))->assertOk()->assertJsonPath('data.0.id', $rec->json('data.id'))->assertJsonPath('data.0.report', null);
});

it('excludes a statement line with a reason, keeps it in the arithmetic, and lets finish through', function (): void {
    $this->sale(1000000, '2026-03-01');
    $receipt = $this->bankReceipt(1100000, '2026-03-02', 'INV-1');
    $this->importStatement()->assertCreated();
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $lines = $this->bankLines();
    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$lines['ACME LTD payment']['id']], 'settlement_ids' => [$receipt['id']]], $this->key())->assertCreated();
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$lines['Office supplies']['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('5000')], $this->key())->assertCreated();

    $fee = $lines['BANK FEE MARCH'];
    $this->postJson($this->api("bank-statement-lines/{$fee['id']}/exclude"), ['version' => $fee['version']], $this->key())->assertUnprocessable()->assertJsonValidationErrors(['reason']);
    $excluded = $this->asPerson($this->accountant)->postJson($this->api("bank-statement-lines/{$fee['id']}/exclude"), ['version' => $fee['version'], 'reason' => 'Bank error, refunded in April'], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'excluded')->assertJsonPath('data.excluded_reason', 'Bank error, refunded in April');
    $this->postJson($this->api("bank-statement-lines/{$fee['id']}/exclude"), ['version' => $excluded->json('data.version'), 'reason' => 'Again'], $this->key())->assertUnprocessable()->assertJson(['code' => 'bank_line_not_open']);
    $this->postJson($this->api('bank-matches'), ['statement_line_ids' => [$fee['id']], 'settlement_ids' => [$receipt['id']]], $this->key())->assertUnprocessable();

    $rec = $this->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertCreated();
    expect($rec->json('data.report.unmatched_statement.count'))->toBe(0)->and($rec->json('data.report.excluded_statement'))->toBe(['total' => -1500, 'count' => 1])
        ->and(collect($rec->json('data.report.unmatched_statement_items'))->pluck('id'))->not->toContain($fee['id'])
        ->and($rec->json('data.report.difference'))->toBe(0);

    $this->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $this->key())->assertOk();
    // A finished reconciliation holds it; reopening lets it come back.
    $this->postJson($this->api("bank-statement-lines/{$fee['id']}/restore"), ['version' => $excluded->json('data.version')], $this->key())->assertStatus(422)->assertJson(['code' => 'reconciliation_finished']);
    $this->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/reopen'), ['reason' => 'Bank line was real'], $this->key())->assertOk();
    $this->postJson($this->api("bank-statement-lines/{$fee['id']}/restore"), ['version' => $excluded->json('data.version')], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'unmatched')->assertJsonPath('data.excluded_reason', null);
    $this->inTenant(fn () => expect(DB::table('audit_events')->whereIn('action', ['bank_line.excluded', 'bank_line.restored'])->count())->toBe(2));
});

it('answers an account edit with its figures', function (): void {
    $this->asPerson($this->owner);
    $account = $this->getJson($this->api("bank-accounts/{$this->bank}"))->assertOk()->json('data');
    $body = ['name' => 'Renamed', 'version' => $account['version'], ...array_intersect_key($account, array_flip(['account_id', 'currency']))];

    $this->putJson($this->api("bank-accounts/{$this->bank}"), $body, $this->key())->assertOk()
        ->assertJsonPath('data.name', 'Renamed')->assertJsonPath('data.book_balance.amount', $account['book_balance']['amount']);
});

it('refuses to finish while the statement and the books disagree', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->bankReceipt(1100000, '2026-03-02', 'INV-1');
    // The file says closing 10,876.00 but its lines add up to 10,875.00.
    $this->importStatement('march_us.csv', ['closing_balance' => 1087600])->assertCreated()->assertJsonPath('data.warnings.0', 'statement_balance_mismatch');
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $rec = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertCreated();

    // Book 1,100,000; unmatched book 1,100,000 (outstanding); unmatched statement 1,087,500; adjusted 1,087,500; difference 1,087,600 − 1,087,500 = 100.
    expect($rec->json('data.report.difference'))->toBe(100);
    $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'reconciliation_difference');
    $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertUnprocessable()->assertJsonPath('code', 'reconciliation_exists');
});

it('adds BANK_REC to the period close checks: unmatched statement lines in the period fail it until matched', function (): void {
    $this->importStatement()->assertCreated();
    $period = $this->inTenant(fn () => $this->f->period('2026-03-15')->id);
    $codes = fn () => collect($this->asPerson($this->owner)->getJson($this->api("fiscal-periods/{$period}/close-checks"))->assertOk()->json('data'))->keyBy('code');

    expect($codes()['BANK_REC']['passed'])->toBeFalse();
    $ids = array_map(fn (array $l): string => $l['id'], $this->bankLines());
    foreach (['BANK FEE MARCH' => ['6300', 'spend'], 'Office supplies' => ['5000', 'spend']] as $desc => [$acc, $kind]) {
        $this->asPerson($this->accountant, signing: true)->postJson($this->api('bank-statement-lines/'.$ids[$desc].'/transactions'), ['kind' => $kind, 'account_id' => $this->f->account($acc)], $this->key())->assertCreated();
    }
    expect($codes()['BANK_REC']['passed'])->toBeFalse();
    $this->asPerson($this->accountant, signing: true)->postJson($this->api('bank-statement-lines/'.$ids['ACME LTD payment'].'/transactions'), ['kind' => 'receive', 'account_id' => $this->f->account('4000')], $this->key())->assertCreated();
    expect($codes()['BANK_REC']['passed'])->toBeTrue();
});

it('wires settlements to bank accounts: the bank account must sit on the cash account and in its currency', function (): void {
    $this->sale(1000000, '2026-03-01');
    $body = fn (string $cash, array $extra) => $this->settlementBody('receipt', $this->t->customer, 1100000, [], '2026-03-02', $cash, $extra);
    $ok = $this->draftDoc('settlements', $body('1010', ['bank_account_id' => $this->bank]));
    expect($ok['bank_account_id'])->toBe($this->bank);
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $body('1000', ['bank_account_id' => $this->bank]), $this->key())->assertUnprocessable()->assertJsonPath('code', 'bank_account_mismatch');
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $body('1010', ['bank_account_id' => $this->bank, 'currency' => 'EUR', 'fx_rate' => '1.1']), $this->key())->assertUnprocessable();
});

it('validates bank accounts: GL account of control type bank or cash, currency the account allows, one bank account per GL account', function (): void {
    $make = fn (array $b) => $this->asPerson($this->owner)->postJson($this->api('bank-accounts'), $b, $this->key());
    $make(['name' => 'X', 'account_id' => $this->f->account('4000'), 'currency' => 'USD'])->assertUnprocessable()->assertJsonPath('code', 'bank_gl_account_invalid');
    $make(['name' => 'X', 'account_id' => $this->f->account('1000'), 'currency' => 'EUR'])->assertUnprocessable()->assertJsonPath('code', 'currency_not_allowed');
    $make(['name' => 'Y', 'account_id' => $this->f->account('1010'), 'currency' => 'USD'])->assertUnprocessable()->assertJsonPath('code', 'bank_gl_account_taken');
    $make(['name' => 'Cash', 'account_id' => $this->f->account('1000'), 'currency' => 'USD', 'kind' => 'cash'])->assertCreated();
    $make(['name' => 'Euro', 'account_id' => $this->f->account('1200'), 'currency' => 'EUR'])->assertCreated();

    $list = $this->asPerson($this->viewer ?? $this->owner)->getJson($this->api('bank-accounts'))->assertOk()->json('data');
    expect($list)->toHaveCount(3)->and($list[0]['can']['update'])->toBeTrue();
    // The GL account cannot change once the account has lines.
    $this->importStatement()->assertCreated();
    $this->asPerson($this->owner)->putJson($this->api("bank-accounts/{$this->bank}"), ['name' => 'Main', 'account_id' => $this->f->account('1000'), 'currency' => 'USD', 'version' => 0], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'bank_account_in_use');
    $this->asPerson($this->owner)->putJson($this->api("bank-accounts/{$this->bank}"), ['name' => 'Main account', 'account_id' => $this->f->account('1010'), 'currency' => 'USD', 'version' => 5], $this->key())
        ->assertStatus(409);
});

it('authorizes by permission and token ability: people reconcile, tokens read and import only', function (): void {
    $viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->asPerson($viewer)->getJson($this->api('bank-accounts'))->assertOk();
    $this->asPerson($viewer)->postJson($this->api('bank-rules'), ['name' => 'r'], $this->key())->assertForbidden();
    $this->asPerson($viewer)->post($this->api("bank-accounts/{$this->bank}/statements"), ['file' => $this->fixtureFile('march_us.csv')], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->postJson($this->api('bank-accounts'), ['name' => 'Z', 'account_id' => $this->f->account('1000'), 'currency' => 'USD'], $this->key())->assertForbidden();

    $read = $this->newToken(['banking:read']);
    $write = $this->newToken(['banking:write']);
    $this->asToken($read)->getJson($this->api('bank-accounts'))->assertOk();
    $this->asToken($read)->getJson($this->api("bank-accounts/{$this->bank}/lines"))->assertOk();
    $this->asToken($write)->getJson($this->api('bank-accounts'))->assertForbidden();
    $this->asToken($read)->post($this->api("bank-accounts/{$this->bank}/statements"), ['file' => $this->fixtureFile('march_camt053.xml')], $this->key())->assertForbidden();
    $this->asToken($write)->post($this->api("bank-accounts/{$this->bank}/statements"), ['file' => $this->fixtureFile('march_camt053.xml')], [...$this->key(), 'Accept' => 'application/json'])->assertCreated()->assertJsonPath('data.lines_imported', 3);
    foreach ([['post', 'bank-matches'], ['post', 'bank-reconciliations'], ['post', 'bank-rules'], ['put', 'bank-rules/order']] as [$method, $path]) {
        $this->asToken($this->newToken(['banking:read', 'banking:write', 'journals:write', 'journals:submit']))->{$method.'Json'}($this->api($path), [], $this->key())->assertForbidden();
    }
});

it('refuses a finished reconciliation being finished by someone without banking.reconcile and a statement of another company', function (): void {
    $this->importStatement()->assertCreated();
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $other = $this->secondCompany();
    $this->asPerson($this->approver)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertForbidden();
    $this->inTenant(fn () => $this->asPerson($this->owner));
    $this->asPerson($this->owner)->postJson($this->api('bank-reconciliations', $other->id), ['statement_id' => $statement], $this->key())->assertStatus(403);
});

it('books a foreign-currency bank line in the bank currency: EUR 150.00 at 1.10 is 165.00 base, both lines carry EUR 150.00', function (): void {
    $eur = $this->asPerson($this->owner)->postJson($this->api('bank-accounts'), ['name' => 'Euro', 'account_id' => $this->f->account('1200'), 'currency' => 'EUR'], $this->key())->assertCreated()->json('data.id');
    $this->inTenant(fn () => $this->t->rate('EUR', '2026-03-05', '1.10'));
    $csv = "Date,Description,Reference,Amount\n2026-03-05,Hosting,H1,-150.00\n";
    $map = json_encode(['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']]);
    $this->importStatement('eur.csv', ['mapping' => $map], $eur, $csv)->assertCreated();
    $line = $this->bankLines($eur)['Hosting'];
    expect($line['amount'])->toBe(['amount' => -15000, 'currency' => 'EUR']);

    $t = $this->asPerson($this->accountant, signing: true)->postJson($this->api("bank-statement-lines/{$line['id']}/transactions"), ['kind' => 'spend', 'account_id' => $this->f->account('5010')], $this->key())->assertCreated();

    $rows = $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $t->json('data.journal_id'))->orderBy('line_no')->get(['account_id', 'debit', 'credit', 'currency', 'amount_fc'])->all());
    expect($rows)->toHaveCount(2)->and([$rows[0]->account_id, (int) $rows[0]->debit, $rows[0]->currency, (int) $rows[0]->amount_fc])->toBe([$this->f->account('5010'), 16500, 'EUR', 15000])
        ->and([$rows[1]->account_id, (int) $rows[1]->credit, $rows[1]->currency, (int) $rows[1]->amount_fc])->toBe([$this->f->account('1200'), 16500, 'EUR', -15000]);
    expect($this->bankLines($eur)['Hosting']['status'])->toBe('matched');
    // A statement file in another currency is refused.
    $this->importStatement('march_camt053.xml', [], $eur)->assertUnprocessable()->assertJsonPath('code', 'statement_currency_mismatch');
});
