<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Resources\Concerns\RendersLineDimensions;
use App\Http\Support\Json;
use App\Models\Procurement\PurchaseRequisitionLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin PurchaseRequisitionLine */
final class PurchaseRequisitionLineResource extends JsonResource
{
    use RendersLineDimensions;

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = $this->resource->requisition->currency;

        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'item_id' => $this->item_id,
            'description' => $this->description,
            'quantity' => (string) $this->quantity,
            'estimated_unit_price' => Json::money($this->estimated_unit_price, $currency),
            'line_total' => Json::money($this->line_total, $currency),
            'account_id' => $this->account_id,
            /** @var array<string, string> dimension id → dimension value id */
            'dimensions' => (object) $this->lineDimensions($request, $this->resource),
            'needed_by' => Json::date($this->needed_by),
            /** The live (not cancelled) order this line is on, if any. */
            'purchase_order' => $this->resource->getRelation('liveOrder'),
        ];
    }
}
