<?php

declare(strict_types=1);

namespace App\Services\Transactions;

use App\Actions\Transactions\Inputs\WriteOffDraftInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PostingSupport;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\RealisedFx;
use App\Domain\Transactions\WriteOffPosting;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Transactions\WriteOff;
use App\Services\Trade\PostingAccountResolver;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/** What a write-off needs: the checks on the invoice, the carried base amount, the allowance available, and the journal. */
final class WriteOffService
{
    public function __construct(private readonly PostingAccountResolver $accounts) {}

    /** @return array<string, mixed> columns of the draft */
    public function header(WriteOffDraftInput $in, Company $company): array
    {
        $invoice = Invoice::query()->where('company_id', $company->id)->find($in->invoiceId)
            ?? throw DomainRuleViolation::single('not_found', 'The invoice does not exist.');
        if (trim($in->reason) === '') {
            throw DomainRuleViolation::single('write_off_reason_required', 'Say why the debt is written off.');
        }
        $this->assertWritable($invoice, $in->amountFc, $in->date);

        return [
            'invoice_id' => $invoice->id, 'contact_id' => $invoice->contact_id, 'write_off_date' => $in->date, 'currency' => $invoice->currency,
            'fx_rate' => (string) $invoice->fx_rate, 'amount_fc' => $in->amountFc,
            'amount' => PostingSupport::toBase($in->amountFc, (string) $invoice->fx_rate), 'allowance_used' => 0, 'recovered_fc' => 0,
            'expense' => PostingSupport::toBase($in->amountFc, (string) $invoice->fx_rate),
            'reason' => trim($in->reason), 'reference' => $in->reference, 'memo' => $in->memo,
        ];
    }

    /** The invoice must be a posted customer invoice, and the amount no more than what is open (a payment settles the net of tax withheld). */
    public function assertWritable(Invoice $invoice, int $amountFc, DateTimeImmutable $date): void
    {
        if ($invoice->kind !== InvoiceKind::SalesInvoice) {
            throw DomainRuleViolation::single('write_off_target_invalid', 'Only a customer invoice can be written off.');
        }
        if ($invoice->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('write_off_invoice_not_posted', 'Only a posted invoice can be written off.');
        }
        if ($date->format('Y-m-d') < $invoice->issue_date->format('Y-m-d')) {
            throw DomainRuleViolation::single('write_off_before_invoice', 'The write-off cannot be dated before the invoice.');
        }
        if ($amountFc < 1 || $amountFc > $invoice->amountDueFc()) {
            throw DomainRuleViolation::single('write_off_exceeds_open_amount', 'The write-off is more than the open amount of the invoice.');
        }
    }

    /** Credit balance of the allowance account on posted lines dated on or before $date (reversed journals net out with their reversals). */
    public function allowanceAvailable(Company $company, string $allowanceAccountId, DateTimeImmutable $date): int
    {
        $net = DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->where('l.company_id', $company->id)->where('l.account_id', $allowanceAccountId)->whereIn('j.status', ['posted', 'reversed'])
            ->where('j.journal_date', '<=', $date->format('Y-m-d'))->selectRaw('COALESCE(SUM(l.credit - l.debit), 0) AS net')->value('net');

        return max(0, (int) $net);
    }

    /** @return array{carried: int, allowance: int, expense: int, proposed: ProposedJournal} */
    public function plan(WriteOff $w, Invoice $invoice, Company $company, string $number): array
    {
        $allowanceRef = $this->accounts->required($company, 'credit_loss_allowance', 'credit-loss allowance');
        $expenseRef = $this->accounts->required($company, 'bad_debt_expense', 'bad-debt expense');
        $contact = Contact::query()->where('company_id', $company->id)->withTrashed()->whereKey($invoice->contact_id)->firstOrFail();
        $ar = $contact->ar_account_id ?? $this->accounts->required($company, 'ar_control', 'receivables control');

        $totalFc = $invoice->total_fc - $invoice->wht_amount_fc;
        $totalBase = $invoice->total - $invoice->wht_amount;
        // D4 with nothing received: carried at the invoice's rate, the write-off that clears the invoice takes the remaining base.
        $carried = RealisedFx::of(true, $w->amount_fc, (string) $invoice->fx_rate, (string) $invoice->fx_rate, $totalFc, $totalBase, $invoice->settled_fc, $invoice->settled)->carriedBase;
        $available = $this->allowanceAvailable($company, $allowanceRef, DateTimeImmutable::createFromInterface($w->write_off_date));
        $proposed = WriteOffPosting::journal(
            $w->id, $number, $w->write_off_date->format('Y-m-d'), (string) $invoice->number, $invoice->contact_id, $ar, $allowanceRef, $expenseRef,
            $invoice->currency, (string) $invoice->fx_rate, $w->amount_fc, $carried, $available, $company->base_currency, $w->reason,
        );
        $split = WriteOffPosting::split($carried, $available);

        return ['carried' => $carried, 'allowance' => $split['allowance'], 'expense' => $split['expense'], 'proposed' => $proposed];
    }

    public function toDraft(string $companyId, ProposedJournal $p, string $base): JournalDraft
    {
        $lines = array_map(static function ($l) use ($base): DraftLine {
            $foreign = $l->currency !== $base;

            return new DraftLine(
                accountId: $l->accountRef, debit: $l->debit, credit: $l->credit, currency: $foreign ? $l->currency : null,
                fxRate: $foreign ? $l->fxRate : null, amountFc: $foreign ? $l->amountFc : null, description: $l->description, contactId: $l->contactRef,
            );
        }, $p->lines);

        return new JournalDraft($companyId, $p->journalType, new DateTimeImmutable($p->journalDate), $lines, $p->reference, $p->memo, $p->sourceType, $p->sourceId);
    }
}
