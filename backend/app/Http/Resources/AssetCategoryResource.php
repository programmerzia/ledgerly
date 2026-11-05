<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\AssetCategory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An asset category. `default_declining_rate_bp` is the annual rate in basis points (2000 = 20% a year).
 *
 * @mixin AssetCategory
 */
final class AssetCategoryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'asset_account_id' => $this->asset_account_id,
            'accumulated_account_id' => $this->accumulated_account_id,
            'expense_account_id' => $this->expense_account_id,
            'measurement_model' => $this->measurement_model,
            'default_method' => $this->default_method,
            'default_life_months' => $this->default_life_months,
            'default_declining_rate_bp' => $this->default_declining_rate_bp,
            'is_depreciable' => $this->is_depreciable,
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update']),
        ];
    }
}
