<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Actions\Procurement\CreateBillFromOrder;
use App\Actions\Procurement\RecordGoodsReceipt;
use App\Actions\Procurement\ReverseGoodsReceipt;
use App\Contracts\Clock;
use App\Http\Controllers\Controller;
use App\Http\Requests\Procurement\BillFromOrderRequest;
use App\Http\Requests\Procurement\GoodsReceiptRequest;
use App\Http\Requests\Procurement\ListPurchaseDocumentsRequest;
use App\Http\Requests\Procurement\ReasonRequest;
use App\Http\Resources\GoodsReceiptResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Trade\Invoice;
use App\Queries\Procurement\ListPurchaseDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Goods receipts (`goods_receipts.*`, tokens `goods_receipts:read|write`). Nothing posts; a mistake is reversed, never edited. */
final class GoodsReceiptController extends Controller
{
    #[Authorize('viewAny', GoodsReceipt::class)]
    public function index(ListPurchaseDocumentsRequest $request, Company $company, ListPurchaseDocuments $list): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($list->receipts($company->id, $request->filter()), $request, 'receipt_date', descending: true, kind: 'date');

        return GoodsReceiptResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'goodsReceipt')]
    public function show(Company $company, GoodsReceipt $goodsReceipt): GoodsReceiptResource
    {
        return $this->fresh($goodsReceipt->id);
    }

    #[Authorize('create', GoodsReceipt::class)]
    public function store(GoodsReceiptRequest $request, Company $company, RecordGoodsReceipt $action): JsonResponse
    {
        $receipt = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return $this->fresh($receipt->id)->response()->setStatusCode(201);
    }

    /** Takes the receipt out of the figures; the row stays, marked reversed. Not while a bill claims it. */
    #[Authorize('reverse', 'goodsReceipt')]
    public function reverse(ReasonRequest $request, Company $company, GoodsReceipt $goodsReceipt, ReverseGoodsReceipt $action): GoodsReceiptResource
    {
        $action->handle(RequestActor::from($request, $company->id), $goodsReceipt->id, $request->version(), $request->reason());

        return $this->fresh($goodsReceipt->id);
    }

    /** Makes a bill draft from what this receipt brought in and is not billed yet. */
    #[Authorize('bill', 'goodsReceipt')]
    public function bill(BillFromOrderRequest $request, Company $company, GoodsReceipt $goodsReceipt, CreateBillFromOrder $action, Clock $clock): JsonResponse
    {
        $bill = $action->handle(RequestActor::from($request, $company->id), $request->toInput($goodsReceipt->purchase_order_id, $clock, $goodsReceipt->id));

        return (new InvoiceResource(Invoice::query()->with('lines')->findOrFail($bill->id)))->response()->setStatusCode(201);
    }

    private function fresh(string $id): GoodsReceiptResource
    {
        return new GoodsReceiptResource(GoodsReceipt::query()->with(['lines.orderLine', 'order.contact'])->findOrFail($id));
    }
}
