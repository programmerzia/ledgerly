<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ApplyCredit;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\ApplyCreditInput;
use App\Actions\Trade\Inputs\ReverseInvoiceInput;
use App\Actions\Trade\Inputs\UpdateInvoiceDraftInput;
use App\Actions\Trade\ReverseInvoice;
use App\Actions\Trade\UpdateInvoiceDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Trade\ApplyCreditRequest;
use App\Http\Requests\Trade\InvoiceRequest;
use App\Http\Requests\Trade\ListInvoicesRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\CreditApplicationResource;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Queries\Trade\ListInvoices;
use App\Queries\Trade\PreviewInvoicePosting;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The behaviour shared by /invoices (invoices and credit notes) and /bills (bills and debit notes). The two
 * controllers differ only in the route parameter, the policy abilities and the document type; every rule lives
 * in the Actions and the policy.
 */
trait HandlesTradeDocuments
{
    protected function listing(ListInvoicesRequest $request, Company $company, ListInvoices $invoices): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($invoices($company->id, $request->filter()), $request, 'issue_date', descending: true, kind: 'date');

        return InvoiceResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    protected function showing(Invoice $invoice): InvoiceResource
    {
        return new InvoiceResource($this->fresh($invoice->id));
    }

    protected function creating(InvoiceRequest $request, Company $company, CreateInvoiceDraft $action): JsonResponse
    {
        $invoice = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new InvoiceResource($this->fresh($invoice->id)))->response()->setStatusCode(201);
    }

    protected function updating(InvoiceRequest $request, Company $company, Invoice $invoice, UpdateInvoiceDraft $action): InvoiceResource
    {
        $action->handle(RequestActor::from($request, $company->id), new UpdateInvoiceDraftInput($invoice->id, $request->version(), $request->toInput($invoice->kind)));

        return new InvoiceResource($this->fresh($invoice->id));
    }

    protected function previewing(Request $request, Company $company, Invoice $invoice, PreviewInvoicePosting $preview): InvoicePostingPreviewResource
    {
        return new InvoicePostingPreviewResource($preview->of(RequestActor::from($request, $company->id), $invoice->id));
    }

    protected function submitting(TransitionRequest $request, Company $company, Invoice $invoice, SubmitDocument $action): InvoiceResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($invoice, $request->version()));

        return new InvoiceResource($this->fresh($invoice->id));
    }

    protected function approving(TransitionRequest $request, Company $company, Invoice $invoice, ApproveDocument $action): InvoiceResource
    {
        $action->handle(RequestActor::from($request, $company->id), $this->ref($invoice, $request->version()), $request->comment());

        return new InvoiceResource($this->fresh($invoice->id));
    }

    protected function returning(ReturnJournalRequest $request, Company $company, Invoice $invoice, ReturnDocument $action): InvoiceResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput($this->ref($invoice, $request->version()), $request->comment()));

        return new InvoiceResource($this->fresh($invoice->id));
    }

    protected function voiding(VoidJournalRequest $request, Company $company, Invoice $invoice, VoidDocument $action): InvoiceResource
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput($this->ref($invoice, $request->version()), $request->reason()));

        return new InvoiceResource($this->fresh($invoice->id));
    }

    /** Reverses the posted document; answers it with status `reversed` and the id of the mirror journal. */
    protected function reversing(ReverseJournalRequest $request, Company $company, Invoice $invoice, ReverseInvoice $action): InvoiceResource
    {
        $in = $request->toInput($invoice->id);
        $action->handle(RequestActor::from($request, $company->id), new ReverseInvoiceInput($invoice->id, $in->date, $in->lockVersion, $in->memo));

        return new InvoiceResource($this->fresh($invoice->id));
    }

    /** Applies a posted credit or debit note to an open document of the same contact and currency (D9). */
    protected function allocating(ApplyCreditRequest $request, Company $company, Invoice $note, ApplyCredit $action): JsonResponse
    {
        $v = $request->validated();
        $application = $action->handle(RequestActor::from($request, $company->id), new ApplyCreditInput(
            (string) $v['invoice_id'], (int) $v['amount_fc'], noteId: $note->id,
            date: isset($v['date']) ? new DateTimeImmutable((string) $v['date']) : null,
        ));
        $application->setAttribute('currency', $note->currency);

        return (new CreditApplicationResource($application))->response()->setStatusCode(201);
    }

    private function ref(Invoice $invoice, ?int $version): DocumentRef
    {
        return new DocumentRef($invoice->kind->documentType(), $invoice->id, $version);
    }

    private function fresh(string $id): Invoice
    {
        return Invoice::query()->with('lines')->findOrFail($id);
    }
}
