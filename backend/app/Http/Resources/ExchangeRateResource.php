<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Fx\ExchangeRate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ExchangeRate */
final class ExchangeRateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'from_currency' => $this->from_currency,
            'to_currency' => $this->to_currency,
            'rate_date' => Json::date($this->rate_date),
            'rate' => $this->rate,
            'source' => $this->source,
            'created_by' => $this->created_by,
            'created_at' => Json::time($this->created_at),
        ];
    }
}
