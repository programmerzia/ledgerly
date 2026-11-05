<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ApplyCredit;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\ReverseInvoice;
use App\Actions\Trade\UpdateInvoiceDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\ReverseJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Trade\ApplyCreditRequest;
use App\Http\Requests\Trade\InvoiceRequest;
use App\Http\Requests\Trade\ListInvoicesRequest;
use App\Http\Requests\Trade\SubmitInvoiceRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\DocumentPaymentResource;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Queries\Trade\ListDocumentPayments;
use App\Queries\Trade\ListInvoices;
use App\Queries\Trade\PreviewInvoicePosting;
use App\Support\Warnings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Sales invoices and credit notes (`invoices.*`, tokens `invoices:read|write|submit`). */
final class InvoiceController extends Controller
{
    use HandlesTradeDocuments;

    #[Authorize('viewAnyInvoices', Invoice::class)]
    public function index(ListInvoicesRequest $request, Company $company, ListInvoices $invoices): AnonymousResourceCollection
    {
        return $this->listing($request, $company, $invoices);
    }

    #[Authorize('view', 'invoice')]
    public function show(Company $company, Invoice $invoice): InvoiceResource
    {
        return $this->showing($invoice);
    }

    #[Authorize('createInvoice', Invoice::class)]
    public function store(InvoiceRequest $request, Company $company, CreateInvoiceDraft $action): JsonResponse
    {
        return $this->creating($request, $company, $action);
    }

    /** Settlements and credits applied to this document. */
    #[Authorize('view', 'invoice')]
    public function payments(Company $company, Invoice $invoice, ListDocumentPayments $payments): AnonymousResourceCollection
    {
        return DocumentPaymentResource::collection(array_map(fn (array $r) => [...$r, 'currency' => $invoice->currency], $payments($invoice)));
    }

    #[Authorize('update', 'invoice')]
    public function update(InvoiceRequest $request, Company $company, Invoice $invoice, UpdateInvoiceDraft $action): InvoiceResource
    {
        return $this->updating($request, $company, $invoice, $action);
    }

    /** What posting this draft would do (the journal lines), or why it cannot. Writes nothing. */
    #[Authorize('view', 'invoice')]
    public function preview(Request $request, Company $company, Invoice $invoice, PreviewInvoicePosting $preview): InvoicePostingPreviewResource
    {
        return $this->previewing($request, $company, $invoice, $preview);
    }

    /** Posts at once when no workflow applies (a person needs a signing grant), else waits for approval. */
    #[Authorize('submit', 'invoice')]
    public function submit(SubmitInvoiceRequest $request, Company $company, Invoice $invoice, SubmitDocument $action, Warnings $warnings): InvoiceResource
    {
        $warnings->clear();
        $action->handle(
            RequestActor::from($request, $company->id), new DocumentRef($invoice->kind->documentType(), $invoice->id, $request->version()), null, $request->creditLimitReason(),
        );

        return (new InvoiceResource(Invoice::query()->with('lines')->findOrFail($invoice->id)))->additional(['warnings' => $warnings->all()]);
    }

    #[Authorize('approve', 'invoice')]
    public function approve(TransitionRequest $request, Company $company, Invoice $invoice, ApproveDocument $action): InvoiceResource
    {
        return $this->approving($request, $company, $invoice, $action);
    }

    #[Authorize('return', 'invoice')]
    public function return(ReturnJournalRequest $request, Company $company, Invoice $invoice, ReturnDocument $action): InvoiceResource
    {
        return $this->returning($request, $company, $invoice, $action);
    }

    #[Authorize('void', 'invoice')]
    public function void(VoidJournalRequest $request, Company $company, Invoice $invoice, VoidDocument $action): InvoiceResource
    {
        return $this->voiding($request, $company, $invoice, $action);
    }

    #[Authorize('reverse', 'invoice')]
    public function reverse(ReverseJournalRequest $request, Company $company, Invoice $invoice, ReverseInvoice $action): InvoiceResource
    {
        return $this->reversing($request, $company, $invoice, $action);
    }

    /** Applies this posted credit note to an open invoice of the same contact, up to the open amount of both. */
    #[Authorize('allocate', 'invoice')]
    public function allocate(ApplyCreditRequest $request, Company $company, Invoice $invoice, ApplyCredit $action): JsonResponse
    {
        return $this->allocating($request, $company, $invoice, $action);
    }
}
