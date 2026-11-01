<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\UpdateInvoiceDraftInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Trade\Invoice;
use App\Models\Trade\InvoiceLine;
use App\Services\Trade\DocumentCalculator;
use App\Services\Trade\InvoiceWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft's header and lines and prices it again, guarded by lock_version (13 §8). The kind never changes. */
final class UpdateInvoiceDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly DocumentCalculator $calculator,
        private readonly InvoiceWriter $writer,
    ) {}

    public function handle(Actor $actor, UpdateInvoiceDraftInput $in): Invoice
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = Invoice::query()->findOrFail($in->invoiceId);
            $this->guard->require($actor, $seen->kind->documentType().'s.create', $seen->company_id, tokens: true);

            $invoice = $locks->document($seen, $in->lockVersion);
            if ($invoice->status !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited; a document that was returned is a draft again.');
            }
            $draft = $in->draft;
            if ($draft->kind !== $invoice->kind || $draft->companyId !== $invoice->company_id) {
                throw DomainRuleViolation::single('document_kind_fixed', 'The kind of a document cannot change.');
            }

            $computed = $this->calculator->compute($draft);
            $this->writer->checkRelated($draft, $computed);

            $before = $invoice->attributesToArray();
            InvoiceLine::query()->where('invoice_id', $invoice->id)->delete();
            $invoice->forceFill([...$this->writer->header($draft, $computed), 'lock_version' => $invoice->lock_version + 1])->save();
            $this->writer->insertLines($actor, $invoice, $computed);

            $audit->add($invoice->kind->documentType().'.updated', $invoice, before: $before, after: $invoice, context: ['lines' => count($computed->lines)]);

            return $invoice;
        });
    }
}
