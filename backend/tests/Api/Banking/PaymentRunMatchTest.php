<?php

declare(strict_types=1);

use Tests\Support\BankingApi;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/*
 * One statement line against a whole payment run (plan 3c.35). A posted run pays each supplier once (here 80.00 and
 * 90.00 from bills of 50.00 + 30.00 and 100.00 less 10.00 withheld). The bank takes the run as one debit of 170.00.
 * The match takes the run's payments together and the sum must be exact, in integer minor units.
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
    /** A posted run paid from the bank account. */
    $this->postedRun = function (): array {
        [$a, $b, $c] = $this->threeBills();
        $body = [...$this->runBody([[$a['id'], 5000], [$b['id'], 3000], [$c['id'], 9000]]), 'cash_account_id' => $this->f->account('1010'), 'bank_account_id' => $this->bank];
        $run = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $body, $this->key())->assertCreated()->json('data');

        return $this->asPerson($this->accountant, signing: true)->postJson($this->api("payment-runs/{$run['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted')->json('data');
    };
    $this->importDebit = function (string $amount, string $name = 'RUN debit'): string {
        $csv = "Date,Description,Reference,Amount\n2026-03-26,{$name},RUN-1,{$amount}\n";
        $this->importStatement('run.csv', ['mapping' => json_encode(['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']])], null, $csv)->assertCreated();

        return $this->bankLines()[$name]['id'];
    };
});

it('matches one statement line to every payment of a run when the sum is exact', function (): void {
    $run = ($this->postedRun)();
    $line = ($this->importDebit)('-170.00');

    $m = $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line], 'payment_run_id' => $run['id']], $this->key())
        ->assertCreated()->assertJsonPath('data.amount.amount', -17000);
    expect($m->json('data.settlement_ids'))->toHaveCount(2)->and($this->bankLines()['RUN debit']['status'])->toBe('matched');
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('refuses a line that is one minor unit off, either way, and leaves the line open', function (string $amount): void {
    $run = ($this->postedRun)();
    $line = ($this->importDebit)($amount);

    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line], 'payment_run_id' => $run['id']], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'match_amount_mismatch');
    expect($this->bankLines()['RUN debit']['status'])->toBe('unmatched');
})->with(['-169.99', '-170.01', '-80.00']);

it('refuses a run that is not posted and a run of another company', function (): void {
    [$a] = $this->threeBills();
    $body = [...$this->runBody([[$a['id'], 5000]]), 'cash_account_id' => $this->f->account('1010'), 'bank_account_id' => $this->bank];
    $draft = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $body, $this->key())->assertCreated()->json('data');
    $line = ($this->importDebit)('-50.00');

    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line], 'payment_run_id' => $draft['id']], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'payment_run_not_matchable');
    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$line], 'payment_run_id' => '00000000-0000-7000-8000-000000000000'], $this->key())
        ->assertUnprocessable();
});

it('does not match a run twice: its payments are already matched', function (): void {
    $run = ($this->postedRun)();
    $csv = "Date,Description,Reference,Amount\n2026-03-26,first,R1,-170.00\n2026-03-26,second,R2,-170.00\n";
    $this->importStatement('two.csv', ['mapping' => json_encode(['columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount']])], null, $csv)->assertCreated();
    $lines = $this->bankLines();

    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$lines['first']['id']], 'payment_run_id' => $run['id']], $this->key())->assertCreated();
    $this->asPerson($this->accountant)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$lines['second']['id']], 'payment_run_id' => $run['id']], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'book_line_already_matched');
});
