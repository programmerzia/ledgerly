<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Fiscal\PeriodReopenRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin PeriodReopenRequest */
final class ReopenRequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fiscal_period_id' => $this->fiscal_period_id,
            'status' => $this->status->value,
            'reason' => $this->reason,
            'requested_by' => $this->requested_by,
            'first_approver' => $this->first_approver,
            'first_signed_at' => Json::time($this->first_signed_at),
            'second_approver' => $this->second_approver,
            'second_signed_at' => Json::time($this->second_signed_at),
            'decided_at' => Json::time($this->decided_at),
            'decision_comment' => $this->decision_comment,
            'can' => Json::can($request, $this->resource, ['approve' => 'approve', 'reject' => 'reject']),
        ];
    }
}
