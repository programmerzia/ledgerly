<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Tax\TaxRate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TaxRate */
final class TaxRateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // A fraction: "0.050000" is 5%.
            'rate' => $this->rate,
            'effective_from' => Json::date($this->effective_from),
            'effective_to' => Json::date($this->effective_to),
        ];
    }
}
