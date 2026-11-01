<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Contracts\Clock;
use App\Http\Support\Json;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxRate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TaxCode */
final class TaxCodeResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $today = app(Clock::class)->now()->format('Y-m-d');

        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'kind' => $this->kind,
            // The rate in force today as a fraction ("0.050000" is 5%); null when none is.
            'rate' => $this->whenLoaded('rates', fn () => $this->rates->first(
                fn (TaxRate $r): bool => $r->effective_from->format('Y-m-d') <= $today && ($r->effective_to === null || $r->effective_to->format('Y-m-d') >= $today),
            )?->rate),
            'rates' => TaxRateResource::collection($this->whenLoaded('rates')),
            'collect_account_id' => $this->collect_account_id,
            'pay_account_id' => $this->pay_account_id,
            'is_recoverable' => $this->is_recoverable,
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate']),
        ];
    }
}
