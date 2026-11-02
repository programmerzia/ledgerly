<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ApplyCredit;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\ReverseInvoice;
use App\Actions\Trade\UpdateInvoiceDraft;
use App\Actions\Workflow\ApproveDocument;
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
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\DocumentPaymentResource;
use App\Http\Resources\InvoicePostingPreviewResource;
use App\Http\Resources\InvoiceResource;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Queries\Trade\ListDocumentPayments;
use App\Queries\Trade\ListInvoices;
use App\Queries\Trade\PreviewInvoicePosting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Purchase bills and debit notes (`bills.*`, tokens `bills:read|write|submit`). */
final class BillController extends Controller
{
    use HandlesTradeDocuments;

    #[Authorize('viewAnyBills', Invoice::class)]
    public function index(ListInvoicesRequest $request, Company $company, ListInvoices $invoices): AnonymousResourceCollection
    {
        return $this->listing($request, $company, $invoices);
    }

    #[Authorize('view', 'bill')]
    public function show(Company $company, Invoice $bill): InvoiceResource
    {
        return $this->showing($bill);
    }

    #[Authorize('createBill', Invoice::class)]
    public function store(InvoiceRequest $request, Company $company, CreateInvoiceDraft $action): JsonResponse
    {
        return $this->creating($request, $company, $action);
    }

    /** Settlements and credits applied to this document. */
    #[Authorize('view', 'bill')]
    public function payments(Company $company, Invoice $bill, ListDocumentPayments $payments): AnonymousResourceCollection
    {
        return DocumentPaymentResource::collection(array_map(fn (array $r) => [...$r, 'currency' => $bill->currency], $payments($bill)));
    }

    #[Authorize('update', 'bill')]
    public function update(InvoiceRequest $request, Company $company, Invoice $bill, UpdateInvoiceDraft $action): InvoiceResource
    {
        return $this->updating($request, $company, $bill, $action);
    }

    /** What posting this draft would do (the journal lines), or why it cannot. Writes nothing. */
    #[Authorize('view', 'bill')]
    public function preview(Request $request, Company $company, Invoice $bill, PreviewInvoicePosting $preview): InvoicePostingPreviewResource
    {
        return $this->previewing($request, $company, $bill, $preview);
    }

    /** Posts at once when no workflow applies (a person needs a signing grant), else waits for approval. */
    #[Authorize('submit', 'bill')]
    public function submit(TransitionRequest $request, Company $company, Invoice $bill, SubmitDocument $action): InvoiceResource
    {
        return $this->submitting($request, $company, $bill, $action);
    }

    #[Authorize('approve', 'bill')]
    public function approve(TransitionRequest $request, Company $company, Invoice $bill, ApproveDocument $action): InvoiceResource
    {
        return $this->approving($request, $company, $bill, $action);
    }

    #[Authorize('return', 'bill')]
    public function return(ReturnJournalRequest $request, Company $company, Invoice $bill, ReturnDocument $action): InvoiceResource
    {
        return $this->returning($request, $company, $bill, $action);
    }

    #[Authorize('void', 'bill')]
    public function void(VoidJournalRequest $request, Company $company, Invoice $bill, VoidDocument $action): InvoiceResource
    {
        return $this->voiding($request, $company, $bill, $action);
    }

    #[Authorize('reverse', 'bill')]
    public function reverse(ReverseJournalRequest $request, Company $company, Invoice $bill, ReverseInvoice $action): InvoiceResource
    {
        return $this->reversing($request, $company, $bill, $action);
    }

    /** Applies this posted debit note to an open bill of the same contact, up to the open amount of both. */
    #[Authorize('allocate', 'bill')]
    public function allocate(ApplyCreditRequest $request, Company $company, Invoice $bill, ApplyCredit $action): JsonResponse
    {
        return $this->allocating($request, $company, $bill, $action);
    }
}
