<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Ledger\DimensionValue;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin DimensionValue */
final class DimensionValueResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'dimension_id' => $this->dimension_id,
            'code' => $this->code,
            'name' => $this->name,
            'parent_id' => $this->parent_id,
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
        ];
    }
}
