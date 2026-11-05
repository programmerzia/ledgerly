<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixed asset scenarios over HTTP, on top of TradeApi (Accountant, Approver and Owner people with real roles): the
 * asset accounts and posting accounts a company needs, a category, and an asset capitalised from a posted manual journal
 * (Dr equipment, Cr cash), the way the register is fed in these tests.
 */
trait AssetApi
{
    protected function setUpAssets(): void
    {
        $this->setUpTrade();
        $f = $this->f;
        foreach ([
            ['1500', 'Equipment', 'asset', 'debit', 'fixed_asset'],
            ['1510', 'Accumulated depreciation: equipment', 'asset', 'credit', 'accum_depr'],
            ['1520', 'Land', 'asset', 'debit', 'fixed_asset'],
            ['1530', 'Accumulated impairment: land', 'asset', 'credit', 'accum_depr'],
            ['1540', 'Other receivables', 'asset', 'debit', 'none'],
            ['6500', 'Depreciation expense', 'expense', 'debit', 'none'],
            ['7500', 'Gain on disposal of assets', 'income', 'credit', 'none'],
            ['8500', 'Loss on disposal of assets', 'expense', 'debit', 'none'],
            ['8600', 'Impairment loss', 'expense', 'debit', 'none'],
            ['7600', 'Reversal of impairment loss', 'income', 'credit', 'none'],
            ['3300', 'Revaluation reserve', 'equity', 'credit', 'none'],
        ] as [$code, $name, $type, $normal, $control]) {
            $f->accounts[$code] = (string) Str::uuid7();
            DB::table('accounts')->insert([
                'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
                'account_type' => $type, 'normal_balance' => $normal, 'control_type' => $control, 'currency_policy' => 'base_only',
            ]);
        }
        $current = $this->inTenant(fn () => json_decode((string) DB::table('company_settings')->where('company_id', $f->companyId)->value('posting_accounts'), true)) ?? [];
        $keys = [
            'asset_disposal_gain' => '7500', 'asset_disposal_loss' => '8500', 'impairment_loss' => '8600',
            'impairment_reversal' => '7600', 'revaluation_reserve' => '3300', 'retained_earnings' => '3000',
        ];
        $this->inTenant(fn () => DB::table('company_settings')->where('company_id', $f->companyId)->update([
            'posting_accounts' => json_encode([...$current, ...array_map(fn (string $code) => $f->account($code), $keys)], JSON_THROW_ON_ERROR),
        ]));
    }

    /**
     * A category for equipment (or $over). Returns the response data.
     *
     * @param  array<string, mixed>  $over
     * @return array<string, mixed>
     */
    protected function assetCategory(array $over = []): array
    {
        return $this->asPerson($this->accountant)->postJson($this->api('asset-categories'), [
            'name' => 'Equipment', 'asset_account_id' => $this->f->account('1500'), 'accumulated_account_id' => $this->f->account('1510'),
            'expense_account_id' => $this->f->account('6500'), 'default_method' => 'straight_line', 'default_life_months' => 120,
            ...$over,
        ], $this->key())->assertCreated()->json('data');
    }

    /** Posts Dr equipment (or $account) / Cr cash for $amount and answers [journal id, id of the asset line]. @return array{0: string, 1: string} */
    protected function assetPurchaseJournal(int $amount = 12000000, string $date = '2026-03-20', string $account = '1500'): array
    {
        $journal = $this->postedDoc('journals', [
            'journal_date' => $date, 'reference' => 'BUY', 'memo' => 'Purchase',
            'lines' => [['account_id' => $this->f->account($account), 'debit' => $amount], ['account_id' => $this->f->account('1000'), 'credit' => $amount]],
        ]);
        $line = $this->inTenant(fn () => (string) DB::table('journal_lines')->where('journal_id', $journal['id'])->where('account_id', $this->f->account($account))->value('id'));

        return [$journal['id'], $line];
    }

    /**
     * Capitalises a fresh purchase as an asset: 120,000.00 by default (12,000,000 minor units).
     *
     * @param  array<string, mixed>  $over
     * @return array<string, mixed>
     */
    protected function capitalisedAsset(string $categoryId, array $over = [], int $amount = 12000000, string $date = '2026-03-20'): array
    {
        [, $line] = $this->assetPurchaseJournal($amount, $date);

        return $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
            'name' => 'Press', 'category_id' => $categoryId, 'source_type' => 'journal_line', 'source_id' => $line,
            'useful_life_months' => 120, ...$over,
        ], $this->key())->assertCreated()->json('data');
    }

    protected function periodId(string $date): string
    {
        return $this->inTenant(fn () => $this->f->period($date)->id);
    }

    /**
     * Drafts the depreciation run for the period containing $date, as the accountant.
     *
     * @param  array<string, int>  $units
     * @return array<string, mixed>
     */
    protected function draftRun(string $date, array $units = []): array
    {
        return $this->asPerson($this->accountant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId($date), 'units' => $units], $this->key())
            ->assertCreated()->json('data');
    }

    /**
     * Drafts and submits a run; with no workflow it posts.
     *
     * @param  array<string, int>  $units
     * @return array<string, mixed>
     */
    protected function postedRun(string $date, array $units = []): array
    {
        $run = $this->draftRun($date, $units);

        return $this->asPerson($this->accountant, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/submit"), [], $this->key())->assertOk()->json('data');
    }

    /** @return list<array{account: string, debit: int, credit: int}> a journal's lines by account code */
    protected function journalLines(string $journalId): array
    {
        $codes = array_flip($this->f->accounts);

        return $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $journalId)->orderBy('line_no')->get()
            ->map(fn ($l) => ['account' => (string) $codes[$l->account_id], 'debit' => (int) $l->debit, 'credit' => (int) $l->credit])->all());
    }
}
