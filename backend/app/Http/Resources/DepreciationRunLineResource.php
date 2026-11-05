<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\DepreciationRunLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One asset's charge in a depreciation run: the months it covers and, when earlier months were skipped, how many are catch-up.
 *
 * @mixin DepreciationRunLine
 */
final class DepreciationRunLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'asset_id' => $this->asset_id,
            'asset_number' => $this->asset?->number,
            'asset_name' => $this->asset?->name,
            'amount' => Json::money($this->amount, Json::baseCurrency($request)),
            'months' => $this->months,
            'units' => $this->units,
            'catch_up_months' => (int) ($this->detail['catch_up_months'] ?? 0),
        ];
    }
}
