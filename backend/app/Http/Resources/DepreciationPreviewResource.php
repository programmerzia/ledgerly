<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\FixedAssets\DepreciationPreviewData;
use App\Queries\FixedAssets\DepreciationPreviewLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a depreciation run would charge. `blockers` are stable codes: period_closed, depreciation_run_exists, earlier_run_pending,
 * units_required, nothing_to_depreciate. `pending_units` are units-of-production assets that need their units before they can be charged.
 *
 * @mixin DepreciationPreviewData
 */
final class DepreciationPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);
        $line = fn (DepreciationPreviewLine $l): array => [
            'asset_id' => $l->assetId, 'asset_number' => $l->assetNumber, 'asset_name' => $l->assetName, 'category_name' => $l->categoryName,
            'method' => $l->method, 'months' => $l->months, 'catch_up_months' => $l->catchUpMonths, 'amount' => Json::money($l->amount, $cur),
            'units' => $l->units, 'carrying_before' => Json::money($l->carryingBefore, $cur), 'carrying_after' => Json::money($l->carryingAfter, $cur),
        ];

        return [
            'period_id' => $this->periodId,
            'period_name' => $this->periodName,
            'as_of' => $this->asOf,
            'total' => Json::money($this->total, $cur),
            'lines' => array_map($line, $this->lines),
            'pending_units' => array_map($line, $this->pendingUnits),
            'blockers' => $this->blockers,
        ];
    }
}
