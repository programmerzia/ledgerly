<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What the transaction tests (plan 3c.8 to 3c.12) need on top of the trade fixture: the accounts behind the new posting keys
 * (funds in transit, realised FX loss, credit-loss allowance, bad-debt expense and recovery, reverse-charge output and input),
 * a USD cash account and a EUR bank account registered as bank accounts, and a way to read a journal line by line.
 * Use after setUpTrade().
 */
trait TransactionsApi
{
    /** @var array<string, string> */
    public array $bank = [];

    protected function setUpTransactions(bool $withPostingKeys = true): void
    {
        $f = $this->f;
        $this->inTenant(function () use ($f, $withPostingKeys): void {
            foreach ([
                ['1016', 'Funds in transit', 'asset', 'debit', 'cash', 'base_only'],
                ['7200', 'Realised FX loss', 'expense', 'debit', 'none', 'base_only'],
                ['1190', 'Allowance for credit losses', 'asset', 'credit', 'none', 'base_only'],
                ['6801', 'Bad debt expense', 'expense', 'debit', 'none', 'base_only'],
                ['7105', 'Bad debts recovered', 'income', 'credit', 'none', 'base_only'],
                ['2302', 'Reverse-charge output VAT', 'liability', 'credit', 'tax', 'base_only'],
                ['1302', 'Reverse-charge input VAT', 'asset', 'debit', 'tax', 'base_only'],
                ['6312', 'Bank charges', 'expense', 'debit', 'none', 'base_only'],
            ] as [$code, $name, $type, $normal, $control, $policy]) {
                $f->accounts[$code] = (string) Str::uuid7();
                DB::table('accounts')->insert([
                    'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
                    'account_type' => $type, 'normal_balance' => $normal, 'control_type' => $control, 'currency_policy' => $policy,
                ]);
            }
            if ($withPostingKeys) {
                $this->setPostingKeys([
                    'bank_in_transit' => '1016', 'fx_realised_loss' => '7200', 'credit_loss_allowance' => '1190', 'bad_debt_expense' => '6801',
                    'bad_debt_recovery' => '7105', 'reverse_charge_output' => '2302', 'reverse_charge_input' => '1302',
                ]);
            }
            foreach (['1000' => ['Cash USD', 'USD', 'cash'], '1200' => ['Bank EUR', 'EUR', 'bank']] as $code => [$name, $currency, $kind]) {
                $this->bank[$code] = (string) Str::uuid7();
                DB::table('bank_accounts')->insert([
                    'id' => $this->bank[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'name' => $name,
                    'account_id' => $f->account((string) $code), 'currency' => $currency, 'kind' => $kind,
                ]);
            }
        });
        $this->t->rate('EUR', '2026-03-10', '1.10000000');
        $this->t->rate('EUR', '2026-03-12', '1.12000000');
    }

    /** @param array<string, string> $codes posting key → account code */
    protected function setPostingKeys(array $codes): void
    {
        $row = DB::table('company_settings')->where('company_id', $this->f->companyId)->first();
        $keys = json_decode((string) $row->posting_accounts, true);
        foreach ($codes as $key => $code) {
            $keys[$key] = $this->f->account($code);
        }
        DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['posting_accounts' => json_encode($keys, JSON_THROW_ON_ERROR)]);
    }

    /**
     * The lines of a journal in order: [account code, debit, credit].
     *
     * @return list<array{0: string, 1: int, 2: int}>
     */
    protected function linesOf(string $journalId): array
    {
        $codes = array_flip($this->f->accounts);

        return $this->inTenant(fn (): array => DB::table('journal_lines')->where('journal_id', $journalId)->orderBy('line_no')->get()
            ->map(fn ($l): array => [(string) $codes[$l->account_id], (int) $l->debit, (int) $l->credit])->all());
    }

    /** Net debit balance of an account over all journal lines. */
    protected function net(string $code): int
    {
        return $this->balance($code);
    }

    /** Puts $amount in the credit-loss allowance with a posted journal: Dr bad-debt expense, Cr allowance. */
    protected function fundAllowance(int $amount, string $date = '2026-03-01'): void
    {
        $this->postedDoc('journals', [
            'journal_date' => $date, 'reference' => 'PROV', 'memo' => 'Provision',
            'lines' => [['account_id' => $this->f->account('6801'), 'debit' => $amount], ['account_id' => $this->f->account('1190'), 'credit' => $amount]],
        ]);
    }
}
