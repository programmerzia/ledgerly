<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Procurement\GoodsReceipt;
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
            'can' => Json::can($request, $this->resource, ['reverse' => 'reverse', 'bill' => 'bill']),
        ];
    }
}
