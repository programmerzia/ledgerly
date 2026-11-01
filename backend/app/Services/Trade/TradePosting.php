<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\BillDocument;
use App\Domain\Trade\BillPosting;
use App\Domain\Trade\DocumentLine;
use App\Domain\Trade\InvoiceDocument;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\InvoicePosting;
use App\Domain\Trade\PostingAccounts;
use App\Domain\Trade\ProposedJournal;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\InvoiceLine;
use DateTimeImmutable;

/**
 * Turns a stored document into the journal it posts (13 §9): re-checks that the lines add up to the stored
 * totals, resolves the control and tax accounts, calls the pure rule in Domain\Trade (parity-tested against the
 * mock) and maps the result to a JournalDraft for the posting engine. Reads the lines it is given, so the caller
 * decides when they were read (under the document lock at posting).
 *
 * Purchases and non-recoverable tax (IAS 2.11 / IAS 16.16: irrecoverable taxes are part of the cost): the
 * share of a line's tax whose tax code is not recoverable is added to that line's expense, and only the
 * recoverable tax goes to the input-tax account. The document total is unchanged.
 */
final class TradePosting
{
    public function draft(Invoice $doc, ?string $number): JournalDraft
    {
        $company = Company::query()->findOrFail($doc->company_id);
        $lines = $doc->lines;
        $all = array_values($lines->all());
        $this->assertFooted($doc, $all);

        $proposed = $this->proposed($doc, $number ?? $doc->number, $company, $all);

        return $this->toDraft($doc, $proposed, $company->base_currency);
    }

    /** @param list<InvoiceLine> $lines */
    private function assertFooted(Invoice $doc, array $lines): void
    {
        $net = array_sum(array_map(fn (InvoiceLine $l): int => $l->line_total_fc, $lines));
        $tax = array_sum(array_map(fn (InvoiceLine $l): int => $l->tax_amount_fc, $lines));
        if ($net !== $doc->subtotal_fc || $tax !== $doc->tax_total_fc || $doc->subtotal_fc + $doc->tax_total_fc !== $doc->total_fc) {
            throw DomainRuleViolation::single('document_totals_inconsistent', 'The lines do not add up to the document totals; save the document again.');
        }
    }

    /** @param list<InvoiceLine> $lines */
    private function proposed(Invoice $doc, ?string $number, Company $company, array $lines): ProposedJournal
    {
        $purchase = ! $doc->kind->isSales();
        $recoverable = $purchase ? $this->recoverability($lines) : [];

        $docLines = [];
        $taxFc = 0;
        foreach ($lines as $l) {
            $irrecoverable = 0;
            foreach ($l->tax_detail as $codeId => $amount) {
                if ($purchase && ! ($recoverable[$codeId] ?? false)) {
                    $irrecoverable += $amount;
                } else {
                    $taxFc += $amount;
                }
            }
            $total = $l->line_total_fc + $irrecoverable;
            if ($total === 0) {
                continue; // a free line carries no accounting
            }
            $dims = [];
            for ($p = 1; $p <= 8; $p++) {
                $value = $l->dimensionValue($p);
                if ($value !== null) {
                    $dims["dim{$p}"] = $value;
                }
            }
            $docLines[] = new DocumentLine($l->id, $l->account_id, $l->description ?? '', $total, $dims, $l->tax_code_id);
        }
        // Tax with no tax_detail (cannot happen for priced documents) would otherwise vanish from the journal.
        if (array_sum(array_map(fn (InvoiceLine $l): int => $l->tax_amount_fc, $lines)) !== array_sum(array_map(fn (InvoiceLine $l): int => array_sum($l->tax_detail), $lines))) {
            throw DomainRuleViolation::single('document_totals_inconsistent', 'The tax detail of the lines does not match their tax; save the document again.');
        }

        $accounts = $this->accounts($doc, $company, $taxFc, $doc->wht_amount_fc);
        $rate = (string) $doc->fx_rate;
        $reference = $doc->reference ?? '';
        $contactRef = $doc->contact_id;
        $issue = $doc->issue_date->format('Y-m-d');
        // D10: base tax with no document-currency tax is refused by the rule; irrecoverable tax is not that case.
        $baseTax = $doc->tax_total_fc === 0 ? $doc->tax_total : 0;

        if (! $purchase) {
            $document = new InvoiceDocument(
                $doc->id, $number, $reference, $doc->memo, $contactRef, $issue, $doc->currency, $rate,
                $docLines, $taxFc, $baseTax, $doc->total_fc,
            );

            return $doc->kind === InvoiceKind::CreditNote ? InvoicePosting::creditNote($document, $accounts) : InvoicePosting::journal($document, $accounts);
        }

        $document = new BillDocument(
            $doc->id, $number, $reference, $doc->memo, $contactRef, $issue, $doc->currency, $rate,
            $docLines, $taxFc, $baseTax, $doc->total_fc, $doc->wht_amount_fc,
        );

        return $doc->kind === InvoiceKind::DebitNote ? BillPosting::debitNote($document, $accounts) : BillPosting::journal($document, $accounts);
    }

    /**
     * @param  list<InvoiceLine>  $lines
     * @return array<string, bool> tax code id → recoverable
     */
    private function recoverability(array $lines): array
    {
        $ids = [];
        foreach ($lines as $l) {
            foreach (array_keys($l->tax_detail) as $id) {
                $ids[$id] = true;
            }
        }
        if ($ids === []) {
            return [];
        }

        /** @var array<string, bool> $map */
        $map = TaxCode::query()->whereIn('id', array_keys($ids))->pluck('is_recoverable', 'id')->map(fn ($v): bool => (bool) $v)->all();

        return $map;
    }

    /** The control account is the contact's own when set, else the company's; the other accounts come from the company settings. */
    private function accounts(Invoice $doc, Company $company, int $recoverableTaxFc, int $whtFc): PostingAccounts
    {
        $raw = CompanySettings::query()->where('company_id', $company->id)->first()?->getAttribute('posting_accounts');
        /** @var array<string, mixed> $settings */
        $settings = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $contact = Contact::query()->where('company_id', $company->id)->withTrashed()->whereKey($doc->contact_id)->first();

        $sales = $doc->kind->isSales();
        $foreign = $doc->currency !== $company->base_currency;

        $control = $sales
            ? ($contact->ar_account_id ?? $this->account($company, $settings, 'ar_control'))
            : ($contact->ap_account_id ?? $this->account($company, $settings, 'ap_control'));

        return new PostingAccounts(
            arControl: $sales ? $control : '',
            apControl: $sales ? '' : $control,
            taxOutput: $sales && $recoverableTaxFc > 0 ? $this->account($company, $settings, 'tax_output') : '',
            taxInput: ! $sales && $recoverableTaxFc > 0 ? $this->account($company, $settings, 'tax_input') : '',
            fxRealised: '',
            fxUnrealised: '',
            rounding: $foreign ? $this->account($company, $settings, 'rounding') : '',
            whtPayable: ! $sales && $whtFc > 0 ? $this->account($company, $settings, 'wht_payable') : '',
        );
    }

    /** @param array<string, mixed> $settings */
    private function account(Company $company, array $settings, string $key): string
    {
        $ref = $settings[$key] ?? null;
        $account = is_string($ref) && $ref !== ''
            ? Account::query()->where('company_id', $company->id)->where(fn ($q) => $q->where('code', $ref)->when(
                preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $ref) === 1,
                fn ($q2) => $q2->orWhere('id', $ref),
            ))->first()
            : null;
        if ($account === null) {
            throw DomainRuleViolation::single('posting_account_missing', "Set the {$key} account (posting_accounts.{$key}) in the company settings.");
        }

        return $account->id;
    }

    /**
     * The domain draws residue lines in the document currency with no foreign amount; here they become base
     * lines (D12: system lines carry real values), so a foreign-currency document still balances in both currencies
     * on its own lines. Dimension keys `dim<position>` become slots.
     */
    private function toDraft(Invoice $doc, ProposedJournal $proposed, string $base): JournalDraft
    {
        $lines = [];
        foreach ($proposed->lines as $i => $l) {
            $dims = [];
            foreach ($l->dimensions as $key => $valueId) {
                $dims[(int) substr($key, 3)] = $valueId;
            }
            $foreign = $l->currency !== $base;
            $isResidue = $foreign && $l->amountFc === 0; // priced lines are never zero, so only the residue line is
            $lines[] = new DraftLine(
                accountId: $l->accountRef,
                debit: $l->debit,
                credit: $l->credit,
                currency: $foreign && ! $isResidue ? $l->currency : null,
                fxRate: $foreign && ! $isResidue ? $l->fxRate : null,
                amountFc: $foreign && ! $isResidue ? $l->amountFc : null,
                dims: $dims,
                description: $l->description,
                contactId: $l->contactRef,
                taxCodeId: $l->taxCodeRef,
                // The first line is the AR/AP control line: that is where the due date lives.
                dueDate: $i === 0 ? $doc->due_date->format('Y-m-d') : null,
            );
        }

        $fcSum = 0;
        foreach ($lines as $line) {
            if ($line->currency !== null) {
                $fcSum += $line->amountFc ?? 0;
            }
        }
        if ($fcSum !== 0) {
            throw DomainRuleViolation::single('document_totals_inconsistent', "The document's foreign-currency amounts do not balance (difference {$fcSum}).");
        }

        return new JournalDraft(
            $doc->company_id, $proposed->journalType, DateTimeImmutable::createFromInterface($doc->issue_date), $lines,
            $proposed->reference, $proposed->memo, $proposed->sourceType, $proposed->sourceId,
        );
    }
}
