<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Fiscal\FiscalPeriod;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin FiscalPeriod */
final class FiscalPeriodResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fiscal_year_id' => $this->fiscal_year_id,
            'number' => $this->number,
            'name' => $this->name,
            'kind' => $this->kind,
            'starts_on' => Json::date($this->starts_on),
            'ends_on' => Json::date($this->ends_on),
            'status' => $this->status->value,
            'soft_closed_at' => Json::time($this->soft_closed_at),
            'closed_at' => Json::time($this->closed_at),
            'closed_by' => $this->closed_by,
            'reopened_count' => $this->reopened_count,
            // The reopen request waiting on this period, if any (loaded with the year list).
            'reopen_request' => $this->whenLoaded('pendingReopenRequest', fn () => $this->pendingReopenRequest === null
                ? null : new ReopenRequestResource($this->pendingReopenRequest)),
            'can' => Json::can($request, $this->resource, ['soft_close' => 'softClose', 'close' => 'close', 'request_reopen' => 'requestReopen']),
        ];
    }
}
