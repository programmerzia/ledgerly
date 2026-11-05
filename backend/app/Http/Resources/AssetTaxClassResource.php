<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\AssetTaxClass;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A tax depreciation class. Rates are basis points a year (2000 = 20%).
 *
 * @mixin AssetTaxClass
 */
final class AssetTaxClassResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'annual_rate_bp' => $this->annual_rate_bp,
            'first_year_rate_bp' => $this->first_year_rate_bp,
            'source' => $this->source,
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update']),
        ];
    }
}
