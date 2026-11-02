<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Trade\Invoice;
use Illuminate\Database\Eloquent\Builder;

/** The company's procurement documents, filtered; the caller paginates (document date, newest first). */
final class ListPurchaseDocuments
{
    /**
     * @param  array{status: string|null, contact_id: string|null, purchase_order_id: string|null}  $f
     * @return Builder<PurchaseRequisition>
     */
    public function requisitions(string $companyId, array $f): Builder
    {
        return PurchaseRequisition::query()->where('company_id', $companyId)->when($f['status'] !== null, fn ($q) => $q->where('status', $f['status']));
    }

    /**
     * @param  array{status: string|null, contact_id: string|null, purchase_order_id: string|null}  $f
     * @return Builder<PurchaseOrder>
     */
    public function orders(string $companyId, array $f): Builder
    {
        return PurchaseOrder::query()->with('contact:id,name')->where('company_id', $companyId)
            ->when($f['status'] !== null, fn ($q) => $q->where('status', $f['status']))
            ->when($f['contact_id'] !== null, fn ($q) => $q->where('contact_id', $f['contact_id']));
    }

    /**
     * @param  array{status: string|null, contact_id: string|null, purchase_order_id: string|null}  $f
     * @return Builder<GoodsReceipt>
     */
    public function receipts(string $companyId, array $f): Builder
    {
        return GoodsReceipt::query()->with('order.contact:id,name')->where('company_id', $companyId)
            ->when($f['status'] !== null, fn ($q) => $q->where('status', $f['status']))
            ->when($f['purchase_order_id'] !== null, fn ($q) => $q->where('purchase_order_id', $f['purchase_order_id']));
    }

    /** @return Builder<GoodsReceipt> */
    public function receiptsOf(string $orderId): Builder
    {
        return GoodsReceipt::query()->with('order.contact:id,name')->where('purchase_order_id', $orderId);
    }

    /** @return Builder<PurchaseOrderRevision> */
    public function revisionsOf(string $orderId): Builder
    {
        return PurchaseOrderRevision::query()->where('purchase_order_id', $orderId);
    }

    /** Bills with a line on this order. @return Builder<Invoice> */
    public function billsOf(string $orderId): Builder
    {
        return Invoice::query()->whereHas('lines', fn ($q) => $q->whereIn('purchase_order_line_id', fn ($s) => $s->select('id')->from('purchase_order_lines')->where('purchase_order_id', $orderId)));
    }
}
