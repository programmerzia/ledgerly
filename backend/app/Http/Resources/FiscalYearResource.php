<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Fiscal\FiscalYear;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin FiscalYear */
final class FiscalYearResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'starts_on' => Json::date($this->starts_on),
            'ends_on' => Json::date($this->ends_on),
            'status' => $this->status,
            'calendar' => $this->calendar,
            'extra_week_period' => $this->extra_week_period,
            'periods' => FiscalPeriodResource::collection($this->whenLoaded('periods')),
            'can' => Json::can($request, $this->resource, ['year_end' => 'yearEnd', 'lock' => 'lock']),
        ];
    }
}
