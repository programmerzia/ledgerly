<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Procurement\Quantity;
use App\Domain\Trade\LineAmount;
use App\Domain\Trade\PostingSupport;
use App\Models\Procurement\PurchaseOrder;

/** Lines of approved orders with something still to come, soonest expected first; orders with no expected date last. */
final class OrdersAwaitingReceipt
{
    public function __construct(private readonly OrderLineFigures $figures) {}

    /** @return array{rows: list<array{purchase_order_id: string, number: string|null, contact_id: string, contact_name: string, order_date: string, expected_date: string|null, order_line_id: string, line_no: int, description: string|null, item_id: string|null, ordered: string, received: string, open: string, currency: string, open_fc: int, open_base: int}>, total_base: int} */
    public function __invoke(string $companyId, ?string $contactId = null): array
    {
        $orders = PurchaseOrder::query()->where('company_id', $companyId)->whereIn('status', ['approved', 'partly_received'])
            ->when($contactId !== null, fn ($q) => $q->where('contact_id', $contactId))
            ->with(['lines', 'contact:id,name'])
            ->orderByRaw('expected_date NULLS LAST')->orderBy('number')->get();
        $figures = $this->figures->forOrders(array_values($orders->pluck('id')->all()));

        $rows = [];
        foreach ($orders as $order) {
            foreach ($order->lines as $line) {
                $f = $figures[$line->id];
                $open = $f->openToReceive();
                if (Quantity::isZero($open)) {
                    continue;
                }
                $fc = LineAmount::net($open, $line->unit_price_fc);
                $rows[] = [
                    'purchase_order_id' => $order->id, 'number' => $order->number, 'contact_id' => $order->contact_id, 'contact_name' => $order->contact->name,
                    'order_date' => $order->order_date->format('Y-m-d'), 'expected_date' => $order->expected_date?->format('Y-m-d'),
                    'order_line_id' => $line->id, 'line_no' => $line->line_no, 'description' => $line->description, 'item_id' => $line->item_id,
                    'ordered' => $f->ordered, 'received' => $f->received, 'open' => $open,
                    'currency' => $order->currency, 'open_fc' => $fc, 'open_base' => PostingSupport::toBase($fc, (string) $order->fx_rate),
                ];
            }
        }

        return ['rows' => $rows, 'total_base' => array_sum(array_column($rows, 'open_base'))];
    }
}
