<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Banking fixtures on top of TradeApi: GL account 1010 "Bank USD" (control type bank), the bank account "Main" on it, and the March
 * statement files in tests/fixtures/bank (+11,000.00, -15.00, -110.00 = 1,087,500 minor units, opening 0).
 */
trait BankingApi
{
    public string $bank;

    public const array US_MAPPING = ['locale' => 'us', 'columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount', 'balance' => 'Balance']];

    protected function setUpBanking(): void
    {
        $this->setUpTrade();
        $this->f->accounts['1010'] = (string) Str::uuid7();
        $this->f->accounts['6300'] = (string) Str::uuid7();
        $this->inTenant(function (): void {
            foreach ([['1010', 'Bank USD', 'asset', 'debit', 'bank'], ['6300', 'Bank charges', 'expense', 'debit', 'none']] as [$code, $name, $type, $normal, $control]) {
                DB::table('accounts')->insert([
                    'id' => $this->f->accounts[$code], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => $code, 'name' => $name,
                    'account_type' => $type, 'normal_balance' => $normal, 'control_type' => $control, 'currency_policy' => 'base_only',
                ]);
            }
        });
        $this->bank = $this->asPerson($this->owner)->postJson($this->api('bank-accounts'), [
            'name' => 'Main', 'account_id' => $this->f->account('1010'), 'currency' => 'USD', 'bank_name' => 'First Bank',
        ], $this->key())->assertCreated()->json('data.id');
    }

    protected function fixtureFile(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, (string) file_get_contents(__DIR__.'/../fixtures/bank/'.$name));
    }

    /**
     * Uploads a fixture (or inline content) as the accountant.
     *
     * @param  array<string, mixed>  $fields
     */
    protected function importStatement(string $file = 'march_us.csv', array $fields = [], ?string $bank = null, ?string $content = null): TestResponse
    {
        $upload = $content === null ? $this->fixtureFile($file) : UploadedFile::fake()->createWithContent($file, $content);
        $fields = $file === 'march_us.csv' && ! isset($fields['mapping']) ? ['mapping' => json_encode(self::US_MAPPING), ...$fields] : $fields;

        return $this->asPerson($this->accountant)->post($this->api('bank-accounts/'.($bank ?? $this->bank).'/statements'), ['file' => $upload, ...$fields], [...$this->key(), 'Accept' => 'application/json']);
    }

    /** @return array<string, array<string, mixed>> the bank's lines by description */
    protected function bankLines(?string $bank = null): array
    {
        $rows = $this->asPerson($this->owner)->getJson($this->api('bank-accounts/'.($bank ?? $this->bank).'/lines?limit=200'))->assertOk()->json('data');

        return array_column($rows, null, 'description');
    }

    /** A receipt posted on the bank GL account and the bank account (so settlements are wired to banking). @return array<string, mixed> */
    protected function bankReceipt(int $amount, string $date = '2026-03-02', string $reference = 'INV-1', array $allocations = []): array
    {
        return $this->postedSettlement('receipt', $this->t->customer, $amount, $allocations, $date, '1010', ['reference' => $reference, 'bank_account_id' => $this->bank]);
    }
}
