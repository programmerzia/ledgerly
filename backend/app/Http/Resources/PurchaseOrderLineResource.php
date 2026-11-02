<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Procurement\LineFigures;
use App\Http\Resources\Concerns\RendersLineDimensions;
use App\Http\Support\Json;
use App\Models\Procurement\PurchaseOrderLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A line of a purchase order. `received`, `billed`, `open_to_receive` and `received_not_billed` are decimal strings,
 * summed from receipts and bills (never stored); `billed` counts bills that are pending or posted.
 *
 * @mixin PurchaseOrderLine
 */
final class PurchaseOrderLineResource extends JsonResource
{
    use RendersLineDimensions;

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = $this->resource->order->currency;
        $f = $this->resource->getRelation('figures');

        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'item_id' => $this->item_id,
            'account_id' => $this->account_id,
            'description' => $this->description,
            'quantity' => (string) $this->quantity,
            'unit_price_fc' => Json::money($this->unit_price_fc, $currency),
            'tax_code_id' => $this->tax_code_id,
            'line_total_fc' => Json::money($this->line_total_fc, $currency),
            'tax_amount_fc' => Json::money($this->tax_amount_fc, $currency),
            /** @var array<string, string> dimension id → dimension value id */
            'dimensions' => (object) $this->lineDimensions($request, $this->resource),
            'requisition_line_id' => $this->requisition_line_id,
            'received' => $f instanceof LineFigures ? $f->received : null,
            'billed' => $f instanceof LineFigures ? $f->billed : null,
            'open_to_receive' => $f instanceof LineFigures ? $f->openToReceive() : null,
            'received_not_billed' => $f instanceof LineFigures ? $f->receivedNotBilled() : null,
        ];
    }
}
