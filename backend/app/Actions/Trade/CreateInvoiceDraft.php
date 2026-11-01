<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Trade\Invoice;
use App\Services\Trade\DocumentCalculator;
use App\Services\Trade\InvoiceWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Saves an invoice, credit note, bill or debit note as a draft (plan 2.11). The server prices it: the draft
 * carries no number and nothing is validated for posting yet (preview and submit do that).
 */
final class CreateInvoiceDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly DocumentCalculator $calculator,
        private readonly InvoiceWriter $writer,
    ) {}

    public function handle(Actor $actor, InvoiceDraftInput $in): Invoice
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, $in->kind->documentType().'s.create', $in->companyId, tokens: true);

            $computed = $this->calculator->compute($in);
            $this->writer->checkRelated($in, $computed);

            $invoice = new Invoice;
            $invoice->forceFill([
                'id' => $in->id ?? $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'company_id' => $in->companyId,
                'kind' => $in->kind,
                'status' => DocumentStatus::Draft,
                ...$this->writer->header($in, $computed),
                'created_by' => $actor->id,
                'lock_version' => 0,
            ])->save();
            $this->writer->insertLines($actor, $invoice, $computed);

            $audit->add($in->kind->documentType().'.created', $invoice, after: $invoice, context: ['kind' => $in->kind->value, 'lines' => count($computed->lines)]);

            return $invoice;
        });
    }
}
