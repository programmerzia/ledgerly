<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\AssetTransactionLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One asset in an asset transaction, with the amount entered and the carrying amounts before and after.
 *
 * @mixin AssetTransactionLine
 */
final class AssetTransactionLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);
        $facts = $this->figures['facts'] ?? [];

        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'asset_id' => $this->asset_id,
            'asset_number' => $this->asset?->number,
            'asset_name' => $this->asset?->name,
            'input_amount' => Json::money($this->input_amount, $cur),
            'carrying_before' => Json::money((int) ($facts['carrying_before'] ?? $facts['carrying'] ?? 0), $cur),
            'carrying_after' => Json::money((int) ($facts['carrying_after'] ?? 0), $cur),
            'gain_or_loss' => isset($facts['gain_or_loss']) ? Json::money((int) $facts['gain_or_loss'], $cur) : null,
        ];
    }
}
