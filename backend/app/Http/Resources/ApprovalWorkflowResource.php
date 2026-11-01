<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Workflow\ApprovalWorkflow;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalWorkflow */
final class ApprovalWorkflowResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'name' => $this->name,
            'source' => $this->source,
            'min_amount' => Json::money($this->min_amount, $currency),
            'max_amount' => $this->max_amount === null ? null : Json::money($this->max_amount, $currency),
            'steps' => array_map(fn (array $s): array => ['role' => $s['role'], 'count' => (int) ($s['count'] ?? 1)], $this->steps),
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate']),
        ];
    }
}
