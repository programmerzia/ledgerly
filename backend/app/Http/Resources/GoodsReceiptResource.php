<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Procurement\Quantity;
use App\Http\Support\Json;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\GoodsReceiptLine;
use App\Queries\Procurement\OrderLineFigures;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Goods received against a purchase order. A receipt is never edited; reversing it keeps the row with `status` reversed.
 * The list answers summaries; one receipt comes with its lines.
 *
 * @mixin GoodsReceipt
 */
final class GoodsReceiptResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'purchase_order_id' => $this->purchase_order_id,
            'order_number' => $this->order->number,
            'contact_name' => $this->order->contact->name,
            'receipt_date' => Json::date($this->receipt_date),
            'reference' => $this->reference,
            'memo' => $this->memo,
            'reversal_reason' => $this->reversal_reason,
            'reversed_by' => $this->reversed_by,
            'reversed_at' => Json::time($this->reversed_at),
            'version' => $this->lock_version,
            'lines' => $this->whenLoaded('lines', fn () => GoodsReceiptLineResource::collection($this->lines)),
            'can' => $this->can($request),
        ];
    }

    /** `bill` is true only while something this receipt brought in is not on a pending or posted bill yet. */
    /** @return array<string, bool> */
    private function can(Request $request): array
    {
        $can = Json::can($request, $this->resource, ['reverse' => 'reverse', 'bill' => 'bill']);
        if ($can['bill']) {
            $figures = app(OrderLineFigures::class)->forOrder($this->purchase_order_id);
            $lineIds = GoodsReceiptLine::query()->where('goods_receipt_id', $this->id)->pluck('purchase_order_line_id');
            $can['bill'] = $lineIds->contains(fn ($id): bool => isset($figures[$id]) && ! Quantity::isZero($figures[$id]->receivedNotBilled()));
        }

        return $can;
    }
}
