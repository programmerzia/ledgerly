<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PostingSupport;
use App\Domain\Trade\RealisedFx;
use App\Domain\Trade\SettlementAllocation;
use App\Domain\Trade\SettlementDocument;
use App\Domain\Trade\SettlementPosting;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;

/**
 * Turns a settlement and the (locked) documents it settles into its journal, and refuses what must not post (D4, D9, D11):
 * over-allocation, wrong contact, wrong currency, a target of the wrong kind, a cash account that is not cash or bank.
 * The caller reads the rows, so the posting reads them under the locks and the preview reads them unlocked.
 */
final class SettlementPlanner
{
    public function __construct(private readonly PostingAccountResolver $accounts) {}

    /**
     * @param  array<string, Invoice>  $invoices  by id
     * @param  array<string, Settlement>  $sources  by id (credit on account refunded by this settlement)
     */
    public function plan(Settlement $s, Company $company, array $invoices, array $sources, string $number): SettlementPlan
    {
        $this->assertParties($s);
        $cashIn = $s->isCashIn();
        $rate = (string) $s->fx_rate;
        $domainAllocations = [];
        $rows = [];
        $allocatedFc = 0;

        foreach ($s->allocations as $a) {
            if ($a->invoice_id !== null) {
                $doc = $invoices[$a->invoice_id] ?? throw DomainRuleViolation::single('allocation_target_invalid', 'An allocated document does not exist.');
                [$label, $targetRate, $totalFc, $totalBase, $settledFc, $settledBase] = $this->document($s, $doc);
            } else {
                $src = $sources[(string) $a->source_settlement_id] ?? throw DomainRuleViolation::single('allocation_target_invalid', 'The credit to refund does not exist.');
                [$label, $targetRate, $totalFc, $totalBase, $settledFc, $settledBase] = $this->source($s, $src);
            }
            $open = $totalFc - $settledFc;
            if ($a->amount_fc > $open) {
                throw DomainRuleViolation::single('allocation_exceeds_open_amount', "The allocation to {$label} is more than its open amount.");
            }
            $fx = RealisedFx::of($cashIn, $a->amount_fc, $rate, $targetRate, $totalFc, $totalBase, $settledFc, $settledBase);
            $allocatedFc += $a->amount_fc;
            $domainAllocations[] = new SettlementAllocation($a->id, $label, $a->amount_fc, $fx->carriedBase, $fx->gainLoss, $targetRate);
            $rows[] = [
                'id' => $a->id, 'invoice_id' => $a->invoice_id, 'source_id' => $a->source_settlement_id,
                'amount_fc' => $a->amount_fc, 'amount' => $fx->carriedBase, 'fx_gain_loss' => $fx->gainLoss, 'label' => $label,
            ];
        }
        if ($allocatedFc > $s->amount_fc) {
            throw DomainRuleViolation::single('allocation_exceeds_settlement', 'The allocations are more than the settlement amount.');
        }
        $unallocatedFc = $s->amount_fc - $allocatedFc;
        if ($unallocatedFc > 0 && ($s->kind === 'refund' || $s->kind === 'supplier_refund')) {
            // D11: a refund pays back credit that exists (a credit note, credit on account); it never creates a balance.
            throw DomainRuleViolation::single('refund_not_fully_allocated', 'A refund must be allocated in full to credit that is open.');
        }

        $dims = [];
        for ($p = 1; $p <= 8; $p++) {
            $v = $s->getAttribute("dim{$p}_value_id");
            if (is_string($v)) {
                $dims["dim{$p}"] = $v;
            }
        }
        $document = new SettlementDocument(
            $s->id, $s->kind, $number, $s->reference ?? '', $s->memo, $s->contact_id, $s->cash_account_id,
            $s->settlement_date->format('Y-m-d'), $s->currency, $rate, $s->amount_fc, $s->amount, $domainAllocations, $dims,
        );
        $accounts = $this->accounts->forSettlement($company, $s->contact_id, $s->isOnReceivables());
        $proposed = SettlementPosting::journal($document, $accounts, $company->base_currency);

        return new SettlementPlan(
            $document, $rows, $unallocatedFc, $unallocatedFc === 0 ? 0 : PostingSupport::toBase($unallocatedFc, $rate), $proposed,
        );
    }

    private function assertParties(Settlement $s): void
    {
        $contact = Contact::query()->where('company_id', $s->company_id)->whereKey($s->contact_id)->first()
            ?? throw DomainRuleViolation::single('contact_invalid', 'The contact does not exist.');
        $wanted = $s->isOnReceivables() ? ['customer', 'both'] : ['supplier', 'both'];
        if (! in_array($contact->kind, $wanted, true)) {
            throw DomainRuleViolation::single('contact_invalid', 'A '.($s->isOnReceivables() ? 'customer' : 'supplier').' is needed for this settlement.');
        }
        $account = Account::query()->where('company_id', $s->company_id)->whereKey($s->cash_account_id)->first();
        if ($account === null || ! in_array($account->control_type->value, ['cash', 'bank'], true)) {
            throw DomainRuleViolation::single('cash_account_invalid', 'The account must be a cash or bank account of this company.');
        }
    }

    /** @return array{0: string, 1: string, 2: int, 3: int, 4: int, 5: int} label, rate, total fc, total base, settled fc, settled base */
    private function document(Settlement $s, Invoice $doc): array
    {
        $allowed = match ($s->kind) {
            'receipt' => InvoiceKind::SalesInvoice,
            'payment' => InvoiceKind::PurchaseBill,
            'refund' => InvoiceKind::CreditNote,
            default => InvoiceKind::DebitNote,
        };
        if ($doc->kind !== $allowed) {
            throw DomainRuleViolation::single('allocation_target_invalid', "A {$s->kind} settles {$allowed->label()}s only.");
        }
        if ($doc->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('allocation_target_not_posted', "The {$doc->kind->label()} {$doc->number} is not posted.");
        }
        if ($doc->contact_id !== $s->contact_id) {
            throw DomainRuleViolation::single('allocation_contact_mismatch', "The {$doc->kind->label()} {$doc->number} belongs to another contact.");
        }
        if ($doc->currency !== $s->currency) {
            throw DomainRuleViolation::single('allocation_currency_mismatch', "The {$doc->kind->label()} {$doc->number} is in {$doc->currency}, the settlement in {$s->currency}.");
        }

        // What is owed on the control account is the total less the tax withheld at posting (a payment settles the net).
        return [(string) $doc->number, (string) $doc->fx_rate, $doc->total_fc - $doc->wht_amount_fc, $doc->total - $doc->wht_amount, $doc->settled_fc, $doc->settled];
    }

    /** @return array{0: string, 1: string, 2: int, 3: int, 4: int, 5: int} */
    private function source(Settlement $s, Settlement $src): array
    {
        $allowed = $s->kind === 'refund' ? 'receipt' : ($s->kind === 'supplier_refund' ? 'payment' : null);
        if ($allowed === null || $src->kind !== $allowed) {
            throw DomainRuleViolation::single('allocation_target_invalid', 'Only a refund can be allocated to credit on account, of a '.($allowed ?? 'receipt or payment').'.');
        }
        if ($src->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('allocation_target_not_posted', "The settlement {$src->number} is not posted.");
        }
        if ($src->contact_id !== $s->contact_id) {
            throw DomainRuleViolation::single('allocation_contact_mismatch', "The settlement {$src->number} belongs to another contact.");
        }
        if ($src->currency !== $s->currency) {
            throw DomainRuleViolation::single('allocation_currency_mismatch', "The settlement {$src->number} is in {$src->currency}, the refund in {$s->currency}.");
        }

        return [(string) $src->number, (string) $src->fx_rate, $src->unallocated_fc, $src->unallocated, 0, 0];
    }
}
