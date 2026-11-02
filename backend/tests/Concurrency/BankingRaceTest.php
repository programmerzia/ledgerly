<?php

declare(strict_types=1);

use App\Actions\Banking\ImportBankStatement;
use App\Actions\Banking\Inputs\BankAccountInput;
use App\Actions\Banking\Inputs\ImportStatementInput;
use App\Actions\Banking\Inputs\MatchInput;
use App\Actions\Banking\ManageBankAccount;
use App\Actions\Banking\ManageBankReconciliation;
use App\Actions\Banking\MatchStatementLine;
use App\Actions\Trade\CreateSettlementDraft;
use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;
use Tests\Support\TradeFixture;

/*
 * 13 §8: bank matching locks journals (rank 10), the bank account (40), then statement lines (45). A line can be matched once even when
 * two people race for it, a bank line is coded once, and finishing a reconciliation races reversal without breaking the invariant.
 */

/** @return array{0: LedgerFixture, 1: string, 2: string, 3: list<string>} fixture, bank account id, statement line id, settlement ids */
function bankScenario(int $receipts = 2): array
{
    $f = LedgerFixture::create();
    $t = TradeFixture::prepare($f);
    $gl = (string) Str::uuid7();
    DB::table('accounts')->insert(['id' => $gl, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => '1010', 'name' => 'Bank', 'account_type' => 'asset', 'normal_balance' => 'debit', 'control_type' => 'bank', 'currency_policy' => 'base_only']);
    $bank = app(ManageBankAccount::class)->create($f->actor, new BankAccountInput($f->companyId, 'Main', $gl, 'USD'));
    $settlements = [];
    for ($i = 0; $i < $receipts; $i++) {
        $d = app(CreateSettlementDraft::class)->handle($f->signedActor(), new SettlementDraftInput($f->companyId, 'receipt', $t->customer, $gl, new DateTimeImmutable('2026-03-02'), 100000, bankAccountId: $bank->id));
        app(SubmitDocument::class)->handle($f->signedActor(), new DocumentRef('settlement', $d->id));
        $settlements[] = $d->id;
    }
    $csv = "Date,Description,Reference,Amount\n2026-03-02,Customer,R1,1000.00\n";
    $r = app(ImportBankStatement::class)->handle($f->actor, new ImportStatementInput($f->companyId, $bank->id, $csv, 'm.csv', 'csv', ['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']], closingBalance: 100000, openingBalance: 0));
    $line = (string) DB::table('bank_statement_lines')->where('statement_id', $r['statement']?->id)->value('id');

    return [$f, $bank->id, $line, $settlements];
}

it('lets exactly one of two racing people match a statement line', function (): void {
    $this->grant('accounts.manage', 'banking.reconcile', 'receipts.create', 'journals.submit');
    [$f, , $line, $settlements] = bankScenario();
    $users = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth')];

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'bank_match', 'lines' => [$line], 'settlements' => [$settlements[0]], 'user' => $users[0]]],
        [['op' => 'bank_match', 'lines' => [$line], 'settlements' => [$settlements[1]], 'user' => $users[1]]],
    ]));

    expect(Race::errors($flat))->toBe([])->and(Race::ok($flat))->toHaveCount(1)->and(Race::refusals($flat))->toBe(['line_already_matched']);
    expect(DB::table('bank_match_items')->where('statement_line_id', $line)->count())->toBe(1)->and(DB::table('bank_match_items')->whereNotNull('journal_line_id')->count())->toBe(1);
    expect(LedgerChecks::problems())->toBe([]);
});

it('codes a money-out bank line once under a race, and the books stay balanced', function (): void {
    $this->grant('accounts.manage', 'banking.reconcile', 'banking.transactions.create', 'journals.submit');
    $f = LedgerFixture::create();
    $gl = (string) Str::uuid7();
    DB::table('accounts')->insert(['id' => $gl, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => '1010', 'name' => 'Bank', 'account_type' => 'asset', 'normal_balance' => 'debit', 'control_type' => 'bank', 'currency_policy' => 'base_only']);
    $bank = app(ManageBankAccount::class)->create($f->actor, new BankAccountInput($f->companyId, 'Main', $gl, 'USD'));
    $csv = "Date,Description,Reference,Amount\n2026-03-02,Fee,F1,-15.00\n";
    $r = app(ImportBankStatement::class)->handle($f->actor, new ImportStatementInput($f->companyId, $bank->id, $csv, 'f.csv', 'csv', ['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']]));
    $line = (string) DB::table('bank_statement_lines')->where('statement_id', $r['statement']?->id)->value('id');
    $users = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth'), Race::user($f, 'Farah')];

    $flat = Race::flatten(Race::run($f, array_map(fn (string $u): array => [['op' => 'bank_txn', 'id' => $line, 'account' => $f->account('5000'), 'user' => $u]], $users)));

    expect(Race::errors($flat))->toBe([])->and(Race::ok($flat))->toHaveCount(1)->and(Race::refusals($flat))->toBe(['line_not_open', 'line_not_open']);
    expect(DB::table('bank_transactions')->count())->toBe(1)->and(DB::table('bank_match_items')->count())->toBe(2)
        ->and((int) DB::table('journal_lines')->where('account_id', $gl)->sum(DB::raw('debit - credit')))->toBe(-1500);
    expect(LedgerChecks::problems())->toBe([]);
});

it('keeps the reconciliation invariant when finishing races a reversal of a matched receipt', function (): void {
    $this->grant('accounts.manage', 'banking.reconcile', 'receipts.create', 'journals.submit', 'receipts.reverse');
    [$f, , $line, $settlements] = bankScenario(1);
    app(MatchStatementLine::class)->handle($f->actor, new MatchInput($f->companyId, [$line], [], [$settlements[0]]));
    $statement = (string) DB::table('bank_statements')->value('id');
    $rec = app(ManageBankReconciliation::class)->start($f->actor, $f->companyId, $statement);
    $users = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth')];

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'bank_finish', 'id' => $rec->id, 'user' => $users[0]]],
        [['op' => 'reverse_settlement', 'id' => $settlements[0], 'user' => $users[1]]],
    ]));

    expect(Race::errors($flat))->toBe([]);
    $codes = Race::refusals($flat);
    expect(array_diff($codes, ['journal_in_finished_reconciliation']))->toBe([]);
    // Whatever the order, a finished reconciliation never covers a reversal made after it.
    $finished = DB::table('bank_reconciliations')->where('id', $rec->id)->value('status') === 'finished';
    expect($finished)->toBeTrue();
    expect(LedgerChecks::problems())->toBe([]);
});
