<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Procurement\LineFigures;
use App\Domain\Procurement\Quantity;
use App\Models\Procurement\PurchaseOrderLine;
use Illuminate\Database\Eloquent\Builder;

/**
 * Received and billed quantities per order line, summed from the source documents every time, so there is nothing to
 * drift. Received: recorded receipts. Billed: bills pending or posted; a draft claims nothing yet, a reversed or void bill
 * no longer does. Exact: the sums are done by Postgres on numerics and arrive as text.
 */
final class OrderLineFigures
{
    /**
     * @param  list<string>  $orderIds
     * @return array<string, LineFigures> order line id → figures
     */
    public function forOrders(array $orderIds, ?string $exceptBillId = null): array
    {
        return $this->read(PurchaseOrderLine::query()->whereIn('purchase_order_id', $orderIds), $exceptBillId);
    }

    /** @return array<string, LineFigures> */
    public function forOrder(string $orderId, ?string $exceptBillId = null): array
    {
        return $this->forOrders([$orderId], $exceptBillId);
    }

    /**
     * @param  Builder<PurchaseOrderLine>  $lines
     * @return array<string, LineFigures>
     */
    private function read(Builder $lines, ?string $exceptBillId): array
    {
        $rows = $lines->toBase()->select(['id', 'purchase_order_id'])
            ->selectRaw('quantity::text AS ordered')
            ->selectRaw("COALESCE((SELECT SUM(g.quantity) FROM goods_receipt_lines g JOIN goods_receipts r ON r.id = g.goods_receipt_id
                WHERE g.purchase_order_line_id = purchase_order_lines.id AND r.status = 'recorded'), 0)::text AS received")
            ->selectRaw("COALESCE((SELECT SUM(il.quantity) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                WHERE il.purchase_order_line_id = purchase_order_lines.id AND i.kind = 'purchase_bill'
                AND i.status IN ('pending_approval', 'posted') AND i.id IS DISTINCT FROM ?::uuid), 0)::text AS billed", [$exceptBillId])
            ->orderBy('purchase_order_id')->orderBy('line_no')->get();

        $figures = [];
        foreach ($rows as $row) {
            $figures[(string) $row->id] = new LineFigures(
                (string) $row->id, (string) $row->purchase_order_id,
                Quantity::normal((string) $row->ordered), Quantity::normal((string) $row->received), Quantity::normal((string) $row->billed),
            );
        }

        return $figures;
    }
}
