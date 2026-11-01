<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Actions\Trade\Inputs\ApplyCreditInput;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\CreditApplicationFx;
use App\Domain\Trade\CreditApplicationPosting;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\CreditApplicationCreated;
use App\Models\Organisation\Company;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\DraftMapper;
use App\Services\Trade\PostingAccountResolver;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Applies credit on account (an unallocated receipt or payment) or a posted credit or debit note to an open document of
 * the same contact and currency (D9), limited to the open amount of both. No cash moves: the control account is cleared on
 * both items and the exchange difference follows D4 with the credit's own rate as its carried rate. Locks: period, then
 * the settlement (or both documents sorted by id), then the target, then the journal's sequence and balances. A person
 * with a signing grant only (it posts a journal).
 */
final class ApplyCredit
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly PermissionChecker $permissions,
        private readonly PostingAccountResolver $accounts,
        private readonly DraftMapper $mapper,
        private readonly RecordJournal $record,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, ApplyCreditInput $in): CreditApplication
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can apply credit.');
        }
        if (! $actor->hasSigningGrant) {
            throw DomainRuleViolation::single('signature_required', 'Applying credit needs your signing PIN.');
        }
        if (($in->settlementId === null) === ($in->noteId === null)) {
            throw DomainRuleViolation::single('credit_source_invalid', 'Name one settlement or one credit or debit note.');
        }
        if ($in->amountFc <= 0) {
            throw DomainRuleViolation::single('amount_invalid', 'The amount must be greater than zero.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seenTarget = Invoice::query()->findOrFail($in->invoiceId);
            $seenSource = $in->settlementId !== null ? Settlement::query()->findOrFail($in->settlementId) : Invoice::query()->findOrFail((string) $in->noteId);
            $companyId = $seenTarget->company_id;
            $onReceivables = $seenTarget->kind === InvoiceKind::SalesInvoice;
            if (! $this->permissions->allows($actor, ($onReceivables ? 'receipts' : 'payments').'.create', $companyId)) {
                throw DomainRuleViolation::single('forbidden', 'You cannot apply credit in this company.');
            }
            if ($seenSource->company_id !== $companyId) {
                throw DomainRuleViolation::single('not_found', 'The credit does not exist.');
            }

            $sourceDate = $seenSource instanceof Settlement ? $seenSource->settlement_date : $seenSource->issue_date;
            $date = $in->date ?? ($sourceDate > $seenTarget->issue_date ? $sourceDate : $seenTarget->issue_date);
            $date = DateTimeImmutable::createFromInterface($date);
            $period = $this->engine->lockPeriod($locks, $companyId, $onReceivables ? JournalType::Receipt : JournalType::Payment, $date, null); // 1

            if ($seenSource instanceof Settlement) {                                              // 2: the settlement, then the target
                $source = $locks->document($seenSource);
                $target = $locks->document($seenTarget);
            } else {
                $pair = [$seenSource, $seenTarget];
                usort($pair, fn (Invoice $a, Invoice $b): int => strcmp($a->id, $b->id));
                $locked = [];
                foreach ($pair as $row) {
                    $locked[$row->id] = $locks->document($row);
                }
                $source = $locked[$seenSource->id];
                $target = $locked[$seenTarget->id];
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the application date.')]);
            }

            [$srcRate, $srcFc, $srcBase, $srcLabel] = $this->checkSource($source, $target, $onReceivables);
            $this->checkTarget($target, $source);
            $tgtFc = $target->total_fc - $target->wht_amount_fc - $target->settled_fc;
            $tgtBase = $target->total - $target->wht_amount - $target->settled;
            if ($in->amountFc > $tgtFc) {
                throw DomainRuleViolation::single('allocation_exceeds_open_amount', "The amount is more than the open amount of {$target->number}.");
            }
            if ($in->amountFc > $srcFc) {
                throw DomainRuleViolation::single('credit_exceeds_available', "The amount is more than the credit available on {$srcLabel}.");
            }
            $minDate = $sourceDate > $target->issue_date ? $sourceDate : $target->issue_date;
            if ($date < DateTimeImmutable::createFromInterface($minDate)) {
                throw DomainRuleViolation::single('application_date_too_early', 'Credit cannot be applied before both documents exist.');
            }

            $fx = CreditApplicationFx::of($onReceivables, $in->amountFc, $srcRate, $srcFc, $srcBase, (string) $target->fx_rate, $tgtFc, $tgtBase);
            $company = Company::query()->findOrFail($companyId);
            $posting = $this->accounts->forSettlement($company, $target->contact_id, $onReceivables);
            $applicationId = $this->ids->next();
            $proposed = CreditApplicationPosting::journal(
                $onReceivables, $applicationId, $date->format('Y-m-d'), $onReceivables ? $posting->arControl : $posting->apControl, $posting->fxRealised,
                $company->base_currency, $target->contact_id, $target->currency, $in->amountFc, $srcRate, (string) $target->fx_rate, $fx,
                $srcLabel, (string) $target->number,
            );
            $journal = $this->record->handle($actor, new RecordJournalInput($this->mapper->toDraft($companyId, $proposed, $company->base_currency), $period->id));

            $application = new CreditApplication;
            $application->forceFill([
                'id' => $applicationId, 'tenant_id' => $actor->tenantId, 'company_id' => $companyId,
                'settlement_id' => $source instanceof Settlement ? $source->id : null, 'note_id' => $source instanceof Invoice ? $source->id : null,
                'invoice_id' => $target->id, 'amount_fc' => $in->amountFc, 'source_amount' => $fx->sourceBase, 'amount' => $fx->targetBase,
                'fx_gain_loss' => $fx->gainLoss, 'applied_on' => $date, 'journal_id' => $journal->id, 'created_by' => $actor->id,
            ])->save();

            $target->forceFill(['settled_fc' => $target->settled_fc + $in->amountFc, 'settled' => $target->settled + $fx->targetBase, 'lock_version' => $target->lock_version + 1])->save();
            if ($source instanceof Settlement) {
                $source->forceFill(['unallocated_fc' => $source->unallocated_fc - $in->amountFc, 'unallocated' => $source->unallocated - $fx->sourceBase, 'lock_version' => $source->lock_version + 1])->save();
            } else {
                $source->forceFill(['settled_fc' => $source->settled_fc + $in->amountFc, 'settled' => $source->settled + $fx->sourceBase, 'lock_version' => $source->lock_version + 1])->save();
            }

            $audit->add('credit_application.created', $application, after: $application, context: ['journal_id' => $journal->id, 'target' => $target->number, 'source' => $srcLabel]);
            $outbox->add(new CreditApplicationCreated($application->id, $companyId, 0, ['posting_journal_id' => $journal->id, 'invoice_id' => $target->id]));

            return $application;
        });
    }

    /** @return array{0: string, 1: int, 2: int, 3: string} rate, remaining fc, remaining base, label */
    private function checkSource(Settlement|Invoice $source, Invoice $target, bool $onReceivables): array
    {
        if ($source->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('credit_not_posted', 'The credit is not posted.');
        }
        if ($source->contact_id !== $target->contact_id) {
            throw DomainRuleViolation::single('allocation_contact_mismatch', 'The credit and the document belong to different contacts.');
        }
        if ($source->currency !== $target->currency) {
            throw DomainRuleViolation::single('allocation_currency_mismatch', 'The credit and the document are in different currencies.');
        }
        if ($source instanceof Settlement) {
            if ($source->kind !== ($onReceivables ? 'receipt' : 'payment')) {
                throw DomainRuleViolation::single('credit_source_invalid', 'Only credit on account of a '.($onReceivables ? 'receipt' : 'payment').' can be applied to this document.');
            }

            return [(string) $source->fx_rate, $source->unallocated_fc, $source->unallocated, (string) $source->number];
        }
        if ($source->kind !== ($onReceivables ? InvoiceKind::CreditNote : InvoiceKind::DebitNote)) {
            throw DomainRuleViolation::single('credit_source_invalid', 'Only a '.($onReceivables ? 'credit' : 'debit').' note can be applied to this document.');
        }

        return [(string) $source->fx_rate, $source->total_fc - $source->wht_amount_fc - $source->settled_fc, $source->total - $source->wht_amount - $source->settled, (string) $source->number];
    }

    private function checkTarget(Invoice $target, Settlement|Invoice $source): void
    {
        if (! in_array($target->kind, [InvoiceKind::SalesInvoice, InvoiceKind::PurchaseBill], true)) {
            throw DomainRuleViolation::single('allocation_target_invalid', 'Credit applies to an invoice or a bill.');
        }
        if ($target->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('allocation_target_not_posted', "The {$target->kind->label()} {$target->number} is not posted.");
        }
    }
}
