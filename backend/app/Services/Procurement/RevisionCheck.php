<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Actions\Procurement\Inputs\RevisionInput;
use App\Domain\Procurement\RevisionRules;
use App\Domain\Shared\Violation;
use App\Models\Procurement\GoodsReceiptLine;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Trade\InvoiceLine;
use App\Queries\Procurement\OrderLineFigures;

/** Whether a proposal still fits the order as it stands. Run at submit and again under the order's lock when applied. */
final class RevisionCheck
{
    public function __construct(private readonly OrderLineFigures $figures, private readonly RevisionPayload $payload) {}

    /** @return list<Violation> */
    public function violations(PurchaseOrder $order, RevisionInput $in): array
    {
        if (! $order->status->isOpen()) {
            return [new Violation('order_not_open', "A {$order->status->value} order cannot be revised.")];
        }
        $figures = $this->figures->forOrder($order->id);
        $ids = array_keys($figures);
        $linked = [
            ...array_flip(GoodsReceiptLine::query()->whereIn('purchase_order_line_id', $ids)->distinct()->pluck('purchase_order_line_id')->all()),
            ...array_flip(InvoiceLine::query()->whereIn('purchase_order_line_id', $ids)->distinct()->pluck('purchase_order_line_id')->all()),
        ];
        $existing = [];
        foreach ($order->lines as $line) {
            $existing[$line->id] = ['figures' => $figures[$line->id], 'item_id' => $line->item_id, 'linked' => isset($linked[$line->id])];
        }

        return RevisionRules::check($this->payload->ruleLines($in->lines), $existing);
    }
}
