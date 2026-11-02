<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Actions\Procurement\ConvertRequisition;
use App\Actions\Procurement\CreateRequisitionDraft;
use App\Actions\Procurement\RejectRequisition;
use App\Actions\Procurement\UpdateRequisitionDraft;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\Procurement\ConvertRequisitionRequest;
use App\Http\Requests\Procurement\ListPurchaseDocumentsRequest;
use App\Http\Requests\Procurement\ReasonRequest;
use App\Http\Requests\Procurement\RequisitionRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Resources\PurchaseOrderResource;
use App\Http\Resources\PurchaseRequisitionResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseRequisition;
use App\Queries\Procurement\ListPurchaseDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Purchase requisitions (`purchase_requisitions.*`, tokens `purchase_requisitions:read|write|submit`). Nothing here posts. */
final class PurchaseRequisitionController extends Controller
{
    use RunsDocumentTransitions;

    private const string TYPE = 'purchase_requisition';

    #[Authorize('viewAny', PurchaseRequisition::class)]
    public function index(ListPurchaseDocumentsRequest $request, Company $company, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($list->requisitions($company->id, $request->filter()), $request, 'requisition_date', descending: true, kind: 'date');

        return PurchaseRequisitionResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'purchaseRequisition')]
    public function show(Company $company, PurchaseRequisition $purchaseRequisition): PurchaseRequisitionResource
    {
        return $this->fresh($purchaseRequisition->id);
    }

    #[Authorize('create', PurchaseRequisition::class)]
    public function store(RequisitionRequest $request, Company $company, CreateRequisitionDraft $action): JsonResponse
    {
        $requisition = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return $this->fresh($requisition->id)->response()->setStatusCode(201);
    }

    #[Authorize('update', 'purchaseRequisition')]
    public function update(RequisitionRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, UpdateRequisitionDraft $action): PurchaseRequisitionResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseRequisition->id, $request->version(), $request->toInput());

        return $this->fresh($purchaseRequisition->id);
    }

    /** Approves at once when no workflow applies (a person needs a signing grant), else waits for approval. */
    #[Authorize('submit', 'purchaseRequisition')]
    public function submit(TransitionRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, SubmitDocument $action): PurchaseRequisitionResource
    {
        $this->submitDocument($request, $company, self::TYPE, $purchaseRequisition->id, $action);

        return $this->fresh($purchaseRequisition->id);
    }

    #[Authorize('approve', 'purchaseRequisition')]
    public function approve(TransitionRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, ApproveDocument $action): PurchaseRequisitionResource
    {
        $this->approveDocument($request, $company, self::TYPE, $purchaseRequisition->id, $action);

        return $this->fresh($purchaseRequisition->id);
    }

    #[Authorize('return', 'purchaseRequisition')]
    public function return(ReturnJournalRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, ReturnDocument $action): PurchaseRequisitionResource
    {
        $this->returnDocument($request, $company, self::TYPE, $purchaseRequisition->id, $action);

        return $this->fresh($purchaseRequisition->id);
    }

    #[Authorize('void', 'purchaseRequisition')]
    public function void(VoidJournalRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, VoidDocument $action): PurchaseRequisitionResource
    {
        $this->voidDocument($request, $company, self::TYPE, $purchaseRequisition->id, $action);

        return $this->fresh($purchaseRequisition->id);
    }

    /** Turns the requisition down for good, with a reason. A person other than whoever made or submitted it. */
    #[Authorize('reject', 'purchaseRequisition')]
    public function reject(ReasonRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, RejectRequisition $action): PurchaseRequisitionResource
    {
        $action->handle(RequestActor::from($request, $company->id), $purchaseRequisition->id, $request->version(), $request->reason());

        return $this->fresh($purchaseRequisition->id);
    }

    /** Makes a draft order for one supplier from lines of this approved requisition. */
    #[Authorize('convert', 'purchaseRequisition')]
    public function convert(ConvertRequisitionRequest $request, Company $company, PurchaseRequisition $purchaseRequisition, ConvertRequisition $action): JsonResponse
    {
        $order = $action->handle(RequestActor::from($request, $company->id), $request->toInput($purchaseRequisition->id));

        return (new PurchaseOrderResource(PurchaseOrder::query()->with(['lines', 'contact'])->findOrFail($order->id)))->response()->setStatusCode(201);
    }

    private function fresh(string $id): PurchaseRequisitionResource
    {
        return new PurchaseRequisitionResource(PurchaseRequisition::query()->with('lines')->findOrFail($id));
    }
}
