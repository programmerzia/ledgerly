<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Procurement\PurchaseOrderRevision;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A proposed change to an approved order. `proposed` is what it would make the order; `before` and `after` are set when it
 * is applied and keep the order as it was and as it became. `total` is the proposed order total in base currency.
 *
 * @mixin PurchaseOrderRevision
 */
final class PurchaseOrderRevisionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'purchase_order_id' => $this->purchase_order_id,
            'revision_no' => $this->revision_no,
            'status' => $this->status->value,
            'reason' => $this->reason,
            'proposed' => $this->proposed,
            'before' => $this->before,
            'after' => $this->after,
            'total' => Json::money($this->total, Json::baseCurrency($request)),
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'applied_at' => Json::time($this->applied_at),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void',
            ]),
        ];
    }
}
