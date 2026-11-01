<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\InvoiceLine;
use App\Queries\Ledger\DimensionPositions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin InvoiceLine */
final class InvoiceLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = $this->resource->invoice->currency;

        return [
            'line_no' => $this->line_no,
            'item_id' => $this->item_id,
            'account_id' => $this->account_id,
            'description' => $this->description,
            'quantity' => (string) $this->quantity,
            'unit_price_fc' => Json::money($this->unit_price_fc, $currency),
            'discount_pct' => (string) $this->discount_pct,
            'tax_code_id' => $this->tax_code_id,
            // Net of discount, before tax; the tax of the line and its share per tax code (D2).
            'line_total_fc' => Json::money($this->line_total_fc, $currency),
            'tax_amount_fc' => Json::money($this->tax_amount_fc, $currency),
            /** @var array<string, int> tax code id → minor units of the document currency */
            'tax_detail' => (object) ($this->tax_detail ?? []),
            /** @var array<string, string> dimension id → dimension value id */
            'dimensions' => (object) $this->dimensions($request),
        ];
    }

    /** @return array<string, string> */
    private function dimensions(Request $request): array
    {
        /** @var array<int, string>|null $positions */
        $positions = $request->attributes->get('dimension_positions');
        if ($positions === null) {
            $positions = (new DimensionPositions)(Json::company($request)->id);
            $request->attributes->set('dimension_positions', $positions);
        }
        $out = [];
        foreach ($positions as $position => $dimensionId) {
            $valueId = $this->resource->dimensionValue($position);
            if ($valueId !== null) {
                $out[$dimensionId] = $valueId;
            }
        }

        return $out;
    }
}
