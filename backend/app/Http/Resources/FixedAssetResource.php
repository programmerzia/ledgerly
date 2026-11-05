<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\FixedAsset;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A register entry. Money is in the company's base currency. `status` is active or disposed; `fully_depreciated` is derived.
 * `opening_accumulated` is the part of accumulated depreciation brought in at go-live, which the opening balances import carries.
 *
 * @mixin FixedAsset
 */
final class FixedAssetResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);
        $carrying = $this->carrying();

        return [
            'id' => $this->id,
            'number' => $this->number,
            'name' => $this->name,
            'description' => $this->description,
            'category_id' => $this->category_id,
            'category_name' => $this->whenLoaded('category', fn () => $this->category?->name),
            'status' => $this->status,
            'fully_depreciated' => $this->status === 'active' && $carrying <= $this->residual,
            'acquired_on' => Json::date($this->acquired_on),
            'available_from' => Json::date($this->available_from),
            'disposed_on' => Json::date($this->disposed_on),
            'cost' => Json::money($this->cost, $cur),
            'residual' => Json::money($this->residual, $cur),
            'accumulated_depreciation' => Json::money($this->accumulated_depreciation, $cur),
            'accumulated_impairment' => Json::money($this->accumulated_impairment, $cur),
            'carrying_amount' => Json::money($carrying, $cur),
            'revaluation_reserve' => Json::money($this->revaluation_reserve, $cur),
            'method' => $this->method,
            'useful_life_months' => $this->useful_life_months,
            /** Annual rate in basis points. */
            'declining_rate_bp' => $this->declining_rate_bp,
            'units_total' => $this->units_total,
            'units_used' => $this->units_used,
            'months_charged' => $this->months_charged,
            'depreciated_through' => Json::date($this->depreciated_through),
            'is_opening' => $this->is_opening,
            'opening_accumulated' => Json::money($this->opening_accumulated, $cur),
            'opening_as_of' => Json::date($this->opening_as_of),
            'source_type' => $this->source_type,
            'source_id' => $this->source_id,
            'source_journal_id' => $this->source_journal_id,
            'tax_class_id' => $this->tax_class_id,
            /** Dimension position → value id. */
            'dimensions' => array_filter($this->dimensions(), static fn (?string $v): bool => $v !== null),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update']),
        ];
    }
}
