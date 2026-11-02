<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\PostingSupport;
use App\Models\Banking\BankAccount;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Queries\Fx\FindExchangeRate;
use App\Support\Actor;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\DatabaseManager;

/** Writes a draft settlement: the header (rate and base amount are the server's), its dimensions and its allocations. */
final class SettlementWriter
{
    public const array KINDS = ['receipt', 'payment', 'refund', 'supplier_refund'];

    public function __construct(
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
        private readonly FindExchangeRate $rates,
        private readonly SettlementPlanner $planner,
    ) {}

    public static function module(string $kind): string
    {
        return $kind === 'receipt' ? 'receipts' : 'payments';
    }

    /** @return array<string, mixed> */
    public function header(SettlementDraftInput $in, Company $company): array
    {
        if (! in_array($in->kind, self::KINDS, true)) {
            throw DomainRuleViolation::single('settlement_kind_invalid', 'Unknown settlement kind.');
        }
        if ($in->amountFc <= 0) {
            throw DomainRuleViolation::single('amount_invalid', 'The amount must be greater than zero.');
        }
        $currency = $in->currency ?? $company->base_currency;
        self::assertBankAccount($in->bankAccountId, $in->cashAccountId, $currency, $company->id);
        $rate = $this->rate($company, $currency, $in->fxRate, $in->settlementDate->format('Y-m-d'));
        $header = [
            'contact_id' => $in->contactId, 'cash_account_id' => $in->cashAccountId, 'bank_account_id' => $in->bankAccountId,
            'settlement_date' => $in->settlementDate, 'currency' => $currency, 'fx_rate' => $rate,
            'amount_fc' => $in->amountFc, 'amount' => PostingSupport::toBase($in->amountFc, $rate),
            'reference' => $in->reference, 'memo' => $in->memo,
        ];
        for ($p = 1; $p <= 8; $p++) {
            $header["dim{$p}_value_id"] = $in->dims[$p] ?? null;
        }

        return $header;
    }

    /** A named bank account must be this company's, active, on the cash account and in the settlement's currency (05 §10). */
    public static function assertBankAccount(?string $bankAccountId, string $cashAccountId, string $currency, string $companyId): void
    {
        if ($bankAccountId === null) {
            return;
        }
        $bank = BankAccount::query()->where('company_id', $companyId)->find($bankAccountId)
            ?? throw DomainRuleViolation::single('not_found', 'The bank account does not exist.');
        if ($bank->account_id !== $cashAccountId) {
            throw DomainRuleViolation::single('bank_account_mismatch', 'The bank account is linked to a different GL account than the cash account of this settlement.');
        }
        if ($bank->currency !== $currency) {
            throw DomainRuleViolation::single('bank_account_currency_mismatch', "The bank account is in {$bank->currency}, the settlement in {$currency}.");
        }
        if (! $bank->is_active) {
            throw DomainRuleViolation::single('bank_account_inactive', 'The bank account is inactive.');
        }
    }

    public function rate(Company $company, string $currency, ?string $given, string $date): string
    {
        if ($currency === $company->base_currency) {
            return '1';
        }
        $units = $this->db->connection()->table('currencies')->whereIn('code', [$currency, $company->base_currency])->pluck('minor_unit', 'code');
        if (($units[$currency] ?? null) !== ($units[$company->base_currency] ?? null)) {
            throw DomainRuleViolation::single('currency_scale_unsupported', "{$currency} and {$company->base_currency} do not have the same minor units; settlements in {$currency} are not supported yet.");
        }
        if ($given !== null) {
            if (preg_match('/^\d{1,12}(\.\d{1,8})?$/', $given) !== 1 || BigDecimal::of($given)->isZero()) {
                throw DomainRuleViolation::single('fx_rate_invalid', 'The exchange rate must be a positive decimal.');
            }

            return BigDecimal::of($given)->toScale(8, RoundingMode::HalfUp)->__toString();
        }

        return $this->rates->require($company->id, $currency, $company->base_currency, $date)->rate;
    }

    /** Replaces the allocations of a draft (amounts only: carried base and FX are fixed when it posts). */
    public function writeAllocations(Actor $actor, Settlement $s, SettlementDraftInput $in): void
    {
        $seen = [];
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $rows = [];
        foreach ($in->allocations as $a) {
            if (($a->invoiceId === null) === ($a->sourceSettlementId === null)) {
                throw DomainRuleViolation::single('allocation_target_invalid', 'An allocation names one document or one settlement.');
            }
            if ($a->amountFc <= 0) {
                throw DomainRuleViolation::single('amount_invalid', 'An allocation must be greater than zero.');
            }
            $target = (string) ($a->invoiceId ?? $a->sourceSettlementId);
            if (isset($seen[$target])) {
                throw DomainRuleViolation::single('allocation_duplicate', 'A document can be allocated once per settlement.');
            }
            $seen[$target] = true;
            $rows[] = [
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $s->company_id, 'settlement_id' => $s->id,
                'invoice_id' => $a->invoiceId, 'source_settlement_id' => $a->sourceSettlementId, 'amount_fc' => $a->amountFc, 'amount' => 0,
                'fx_gain_loss' => 0, 'created_at' => $now, 'updated_at' => $now,
            ];
        }
        $conn = $this->db->connection();
        $conn->table('settlement_allocations')->where('settlement_id', $s->id)->delete();
        if ($rows !== []) {
            $conn->table('settlement_allocations')->insert($rows);
        }
        $s->unsetRelation('allocations');
    }

    /** Early refusal of what can never post: runs the planner over the unlocked targets. */
    public function validate(Settlement $s, Company $company): void
    {
        $s->load('allocations');
        [$invoices, $sources] = $this->targets($s);
        $this->planner->plan($s, $company, $invoices, $sources, 'Draft');
    }

    /** @return array{0: array<string, Invoice>, 1: array<string, Settlement>} unlocked */
    public function targets(Settlement $s): array
    {
        $invoiceIds = $s->allocations->pluck('invoice_id')->filter()->values()->all();
        $sourceIds = $s->allocations->pluck('source_settlement_id')->filter()->values()->all();
        $invoices = $invoiceIds === [] ? [] : Invoice::query()->where('company_id', $s->company_id)->whereIn('id', $invoiceIds)->get()->keyBy('id')->all();
        $sources = $sourceIds === [] ? [] : Settlement::query()->where('company_id', $s->company_id)->whereIn('id', $sourceIds)->get()->keyBy('id')->all();

        return [$invoices, $sources];
    }
}
