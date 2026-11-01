<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\Item;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Item */
final class ItemResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'description' => $this->description,
            'kind' => $this->kind,
            'currency' => $this->currency,
            'sales_account_id' => $this->sales_account_id,
            'purchase_account_id' => $this->purchase_account_id,
            'sales_price' => Json::money($this->sales_price, $this->currency),
            'purchase_price' => Json::money($this->purchase_price, $this->currency),
            'tax_code_id' => $this->tax_code_id,
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate']),
        ];
    }
}
