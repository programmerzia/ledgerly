<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Tax\TaxGroup;
use App\Models\Tax\TaxGroupItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TaxGroup */
final class TaxGroupResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'is_active' => $this->is_active,
            /** @var list<array{tax_code_id: string, sequence: int, compound: bool}> */
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn (TaxGroupItem $i): array => [
                'tax_code_id' => $i->tax_code_id, 'sequence' => $i->sequence, 'compound' => $i->compound,
            ])->all()),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate']),
        ];
    }
}
