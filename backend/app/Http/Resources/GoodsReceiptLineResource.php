<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Procurement\GoodsReceiptLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin GoodsReceiptLine */
final class GoodsReceiptLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'order_line_id' => $this->purchase_order_line_id,
            'quantity' => (string) $this->quantity,
            'description' => $this->orderLine->description,
        ];
    }
}
