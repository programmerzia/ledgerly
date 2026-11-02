<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Actions\Procurement\CancelPurchaseOrder;
use App\Actions\Procurement\ClosePurchaseOrder;
use App\Actions\Procurement\CreateBillFromOrder;
use App\Actions\Procurement\CreateOrderRevision;
use App\Actions\Procurement\CreatePurchaseOrderDraft;
use App\Actions\Procurement\UpdatePurchaseOrderDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Contracts\Clock;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Procurement\BillFromOrderRequest;
use App\Http\Requests\Procurement\ListPurchaseDocumentsRequest;
use App\Http\Requests\Procurement\PurchaseOrderRequest;
use App\Http\Requests\Procurement\ReasonRequest;
use App\Http\Requests\Procurement\RevisionRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\GoodsReceiptResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PurchaseOrderResource;
use App\Http\Resources\PurchaseOrderRevisionResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Trade\Invoice;
use App\Queries\Procurement\ListPurchaseDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Purchase orders (`purchase_orders.*`, tokens `purchase_orders:read|write|submit`). An order commits, it does not post. */
final class PurchaseOrderController extends Controller
{
    use RunsDocumentTransitions;

    private const string TYPE = 'purchase_order';

    #[Authorize('viewAny', PurchaseOrder::class)]
    public function index(ListPurchaseDocumentsRequest $request, Company $company, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($list->orders($company->id, $request->filter()), $request, 'order_date', descending: true, kind: 'date');

        return PurchaseOrderResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** One order with its lines and what has been received and billed on each. Print from this. */
    #[Authorize('view', 'purchaseOrder')]
    public function show(Company $company, PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        return $this->fresh($purchaseOrder->id);
    }

    #[Authorize('create', PurchaseOrder::class)]
    public function store(PurchaseOrderRequest $request, Company $company, CreatePurchaseOrderDraft $action): JsonResponse
    {
        $order = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return $this->fresh($order->id)->response()->setStatusCode(201);
    }

    #[Authorize('update', 'purchaseOrder')]
    public function update(PurchaseOrderRequest $request, Company $company, PurchaseOrder $purchaseOrder, UpdatePurchaseOrderDraft $action): PurchaseOrderResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseOrder->id, $request->version(), $request->toInput());

        return $this->fresh($purchaseOrder->id);
    }

    #[Authorize('submit', 'purchaseOrder')]
    public function submit(TransitionRequest $request, Company $company, PurchaseOrder $purchaseOrder, SubmitDocument $action): PurchaseOrderResource
    {
        $this->submitDocument($request, $company, self::TYPE, $purchaseOrder->id, $action);

        return $this->fresh($purchaseOrder->id);
    }

    #[Authorize('approve', 'purchaseOrder')]
    public function approve(TransitionRequest $request, Company $company, PurchaseOrder $purchaseOrder, ApproveDocument $action): PurchaseOrderResource
    {
        $this->approveDocument($request, $company, self::TYPE, $purchaseOrder->id, $action);

        return $this->fresh($purchaseOrder->id);
    }

    #[Authorize('return', 'purchaseOrder')]
    public function return(ReturnJournalRequest $request, Company $company, PurchaseOrder $purchaseOrder, ReturnDocument $action): PurchaseOrderResource
    {
        $this->returnDocument($request, $company, self::TYPE, $purchaseOrder->id, $action);

        return $this->fresh($purchaseOrder->id);
    }

    /** Cancels an order nothing has happened on; an approved order keeps its number. */
    #[Authorize('cancel', 'purchaseOrder')]
    public function cancel(ReasonRequest $request, Company $company, PurchaseOrder $purchaseOrder, CancelPurchaseOrder $action): PurchaseOrderResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseOrder->id, $request->version(), $request->reason());

        return $this->fresh($purchaseOrder->id);
    }

    /** Closes an order whose received goods are all billed. */
    #[Authorize('close', 'purchaseOrder')]
    public function close(TransitionRequest $request, Company $company, PurchaseOrder $purchaseOrder, ClosePurchaseOrder $action): PurchaseOrderResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseOrder->id, $request->version());

        return $this->fresh($purchaseOrder->id);
    }

    #[Authorize('view', 'purchaseOrder')]
    public function receipts(Company $company, PurchaseOrder $purchaseOrder, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        return GoodsReceiptResource::collection($list->receiptsOf($purchaseOrder->id)->orderBy('receipt_date')->orderBy('number')->get());
    }

    /** Bills with a line on this order, as summaries. */
    #[Authorize('view', 'purchaseOrder')]
    public function bills(Company $company, PurchaseOrder $purchaseOrder, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        return InvoiceResource::collection($list->billsOf($purchaseOrder->id)->orderBy('issue_date')->orderBy('id')->get());
    }

    #[Authorize('view', 'purchaseOrder')]
    public function revisions(Company $company, PurchaseOrder $purchaseOrder, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        return PurchaseOrderRevisionResource::collection($list->revisionsOf($purchaseOrder->id)->orderBy('created_at')->orderBy('id')->get());
    }

    /** Proposes a change to this approved order. The order stays as it is until the revision is approved. */
    #[Authorize('revise', 'purchaseOrder')]
    public function revise(RevisionRequest $request, Company $company, PurchaseOrder $purchaseOrder, CreateOrderRevision $action): JsonResponse
    {
        $revision = $action->handle(RequestActor::from($request, $company->id), $purchaseOrder->id, $request->version(), $request->toInput());

        return (new PurchaseOrderRevisionResource($revision))->response()->setStatusCode(201);
    }

    /** Makes a bill draft from what this order received and has not billed (or what was ordered, if nothing arrived yet). */
    #[Authorize('bill', 'purchaseOrder')]
    public function bill(BillFromOrderRequest $request, Company $company, PurchaseOrder $purchaseOrder, CreateBillFromOrder $action, Clock $clock): JsonResponse
    {
        $bill = $action->handle(RequestActor::from($request, $company->id), $request->toInput($purchaseOrder->id, $clock));

        return (new InvoiceResource(Invoice::query()->with('lines')->findOrFail($bill->id)))->response()->setStatusCode(201);
    }

    private function fresh(string $id): PurchaseOrderResource
    {
        return new PurchaseOrderResource(PurchaseOrder::query()->with(['lines', 'contact'])->findOrFail($id));
    }
}
