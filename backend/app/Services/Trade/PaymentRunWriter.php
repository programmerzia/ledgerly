<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Actions\Trade\Inputs\PaymentRunDraftInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PostingSupport;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Models\Trade\PaymentRun;
use App\Support\Actor;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\DatabaseManager;

/** Header, totals and items of a draft payment run (the wizard's steps 2 and 3). */
final class PaymentRunWriter
{
    public function __construct(
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
        private readonly SettlementWriter $settlements,
    ) {}

    /**
     * Checks the bills (unlocked: they are checked again under the locks when the run posts) and returns the header
     * columns and the item rows.
     *
     * @return array{0: array<string, mixed>, 1: list<array<string, mixed>>}
     */
    public function build(Actor $actor, PaymentRunDraftInput $in, Company $company): array
    {
        $account = Account::query()->where('company_id', $company->id)->whereKey($in->cashAccountId)->first();
        if ($account === null || ! in_array($account->control_type->value, ['cash', 'bank'], true)) {
            throw DomainRuleViolation::single('cash_account_invalid', 'The account must be a cash or bank account of this company.');
        }
        if ($in->items === []) {
            throw DomainRuleViolation::single('payment_run_empty', 'Select at least one bill.');
        }
        $currency = $in->currency ?? $company->base_currency;
        $rate = $this->settlements->rate($company, $currency, $in->fxRate, $in->runDate->format('Y-m-d'));

        $seen = [];
        $net = 0;
        $wht = 0;
        $rows = [];
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        foreach ($in->items as $i => $item) {
            if (isset($seen[$item['invoice_id']])) {
                throw DomainRuleViolation::single('allocation_duplicate', 'A bill can be in a run once.');
            }
            $seen[$item['invoice_id']] = true;
            $bill = Invoice::query()->where('company_id', $company->id)->find($item['invoice_id'])
                ?? throw DomainRuleViolation::single('allocation_target_invalid', 'A bill does not exist.');
            if ($bill->kind !== InvoiceKind::PurchaseBill || $bill->status !== DocumentStatus::Posted) {
                throw DomainRuleViolation::single('allocation_target_invalid', 'A payment run pays posted bills.');
            }
            if ($bill->currency !== $currency) {
                throw DomainRuleViolation::single('allocation_currency_mismatch', "The bill {$bill->number} is in {$bill->currency}, the run in {$currency}.");
            }
            $open = $bill->total_fc - $bill->wht_amount_fc - $bill->settled_fc;
            if ($item['amount_fc'] <= 0 || $item['amount_fc'] > $open) {
                throw DomainRuleViolation::single('allocation_exceeds_open_amount', "The amount for {$bill->number} must be between 1 and its open amount.");
            }
            $netFc = $bill->total_fc - $bill->wht_amount_fc;
            $share = $netFc === 0 ? 0 : BigDecimal::of($bill->wht_amount_fc)->multipliedBy($item['amount_fc'])->dividedBy($netFc, 0, RoundingMode::HalfUp)->toInt();
            $net += $item['amount_fc'];
            $wht += $share;
            $rows[] = [
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id, 'line_no' => $i + 1,
                'invoice_id' => $bill->id, 'contact_id' => $bill->contact_id, 'amount_fc' => $item['amount_fc'], 'wht_amount_fc' => $share,
                'created_at' => $now, 'updated_at' => $now,
            ];
        }

        return [[
            'cash_account_id' => $in->cashAccountId, 'bank_account_id' => $in->bankAccountId, 'run_date' => $in->runDate,
            'currency' => $currency, 'fx_rate' => $rate, 'total_net' => $net, 'total_wht' => $wht, 'total_gross' => $net + $wht,
            'total' => PostingSupport::toBase($net, $rate), 'reference' => $in->reference, 'memo' => $in->memo,
        ], $rows];
    }

    /** @param list<array<string, mixed>> $rows */
    public function writeItems(PaymentRun $run, array $rows): void
    {
        $conn = $this->db->connection();
        $conn->table('payment_run_items')->where('payment_run_id', $run->id)->delete();
        $conn->table('payment_run_items')->insert(array_map(fn (array $r): array => [...$r, 'payment_run_id' => $run->id], $rows));
        $run->unsetRelation('items');
    }
}
