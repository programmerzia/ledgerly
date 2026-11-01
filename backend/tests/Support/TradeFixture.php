<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Actions\Fx\Inputs\ExchangeRateInput;
use App\Actions\Fx\RecordExchangeRate;
use App\Support\Actor;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What the sales and purchase tests need on top of LedgerFixture: the VAT, withholding and rounding accounts, the
 * company's posting accounts, tax codes with rates (10% VAT recoverable and not, 10% withholding, 0%), a customer
 * and two suppliers. Call right after LedgerFixture::create (the tenant context is still set).
 */
final class TradeFixture
{
    /** @var array<string, string> tax code → id */
    public array $tax = [];

    public string $customer;

    public string $supplier;

    public string $supplierWht;

    private function __construct(private readonly LedgerFixture $f) {}

    public static function prepare(LedgerFixture $f): self
    {
        $t = new self($f);
        foreach ([
            ['2100', 'VAT output', 'liability', 'credit', 'tax', 'base_only'],
            ['2110', 'VAT input', 'asset', 'debit', 'tax', 'base_only'],
            ['2120', 'WHT payable', 'liability', 'credit', 'tax', 'base_only'],
            ['9999', 'Rounding', 'expense', 'debit', 'none', 'base_only'],
            ['4010', 'Export sales', 'income', 'credit', 'none', 'any'],
            ['5010', 'Imported goods', 'expense', 'debit', 'none', 'any'],
        ] as [$code, $name, $type, $normal, $control, $policy]) {
            $f->accounts[$code] = (string) Str::uuid7();
            DB::table('accounts')->insert([
                'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
                'account_type' => $type, 'normal_balance' => $normal, 'control_type' => $control, 'currency_policy' => $policy,
            ]);
        }
        DB::table('company_settings')->updateOrInsert(['company_id' => $f->companyId], [
            'tenant_id' => $f->tenantId,
            'posting_accounts' => json_encode([
                'ar_control' => $f->account('1100'), 'ap_control' => '2000', 'tax_output' => $f->account('2100'),
                'tax_input' => $f->account('2110'), 'wht_payable' => $f->account('2120'), 'rounding' => $f->account('9999'),
            ], JSON_THROW_ON_ERROR),
        ]);

        foreach ([
            'VAT10' => ['vat', true, '0.100000'], 'VATNR' => ['vat', false, '0.100000'], 'ZERO' => ['zero', true, '0.000000'], 'WHT10' => ['wht', false, '0.100000'],
        ] as $code => [$kind, $recoverable, $rate]) {
            $id = (string) Str::uuid7();
            $t->tax[$code] = $id;
            DB::table('tax_codes')->insert(['id' => $id, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $code, 'kind' => $kind, 'is_recoverable' => $recoverable]);
            DB::table('tax_rates')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'tax_code_id' => $id, 'rate' => $rate, 'effective_from' => '2020-01-01']);
        }

        $t->customer = $t->contact('C1', 'customer');
        $t->supplier = $t->contact('S1', 'supplier');
        $t->supplierWht = $t->contact('S2', 'supplier', whtCode: 'WHT10');

        return $t;
    }

    public function contact(string $code, string $kind, string $currency = 'USD', ?string $whtCode = null, int $terms = 30): string
    {
        $id = (string) Str::uuid7();
        DB::table('contacts')->insert([
            'id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'kind' => $kind, 'code' => $code, 'name' => "Contact {$code}",
            'default_currency' => $currency, 'payment_terms_days' => $terms, 'wht_code_id' => $whtCode === null ? null : $this->tax[$whtCode],
        ]);

        return $id;
    }

    public function rate(string $currency, string $date, string $rate): void
    {
        app(RecordExchangeRate::class)->handle(Actor::system($this->f->tenantId, $this->f->companyId), new ExchangeRateInput($this->f->companyId, $currency, 'USD', $date, $rate));
    }

    /**
     * A request body for a draft. Lines: [price, quantity?, tax code?, discount?, account code?]; amounts are never sent.
     *
     * @param  list<array{0: int, 1?: string, 2?: string|null, 3?: string, 4?: string}>  $lines
     * @return array<string, mixed>
     */
    public function body(string $contactId, array $lines, string $date = '2026-03-15', array $extra = []): array
    {
        return [
            'contact_id' => $contactId, 'issue_date' => $date, 'reference' => 'PO-77', 'memo' => 'Test',
            'lines' => array_map(function (array $l): array {
                $line = [
                    'account_id' => $this->f->account($l[4] ?? '4000'), 'description' => 'Item', 'unit_price_fc' => $l[0], 'quantity' => $l[1] ?? '1',
                ];
                if (($l[2] ?? null) !== null) {
                    $line['tax_code_id'] = $this->tax[$l[2]];
                }
                if (isset($l[3])) {
                    $line['discount_pct'] = $l[3];
                }

                return $line;
            }, $lines),
            ...$extra,
        ];
    }

    /** @return array<string, array{debit: int, credit: int}> posted journal lines of a document, by account code (summed) */
    public function journalOf(string $journalId): array
    {
        $codes = array_flip($this->f->accounts);

        return app(TenantContext::class)->run($this->f->tenantId, function () use ($journalId, $codes): array {
            $out = [];
            foreach (DB::table('journal_lines')->where('journal_id', $journalId)->orderBy('line_no')->get() as $l) {
                $code = $codes[$l->account_id];
                $out[$code]['debit'] = ($out[$code]['debit'] ?? 0) + (int) $l->debit;
                $out[$code]['credit'] = ($out[$code]['credit'] ?? 0) + (int) $l->credit;
            }

            return $out;
        });
    }
}
