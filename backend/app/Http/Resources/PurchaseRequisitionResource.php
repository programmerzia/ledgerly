<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Procurement\PurchaseRequisitionLine;
use App\Queries\Procurement\LiveOrdersOfRequisitionLines;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A purchase requisition. Amounts are estimates in the company's base currency. The list answers summaries; one
 * requisition comes with its lines, each with the order it was converted to.
 *
 * @mixin PurchaseRequisition
 */
final class PurchaseRequisitionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = $this->currency;

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'requisition_date' => Json::date($this->requisition_date),
            'currency' => $cur,
            'memo' => $this->memo,
            'total' => Json::money($this->total, $cur),
            'rejection_reason' => $this->rejection_reason,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'approved_at' => Json::time($this->approved_at),
            'version' => $this->lock_version,
            'lines' => $this->whenLoaded('lines', fn () => PurchaseRequisitionLineResource::collection($this->withOrders())),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return',
                'reject' => 'reject', 'void' => 'void', 'convert' => 'convert',
            ]),
        ];
    }

    /** @return Collection<int, PurchaseRequisitionLine> */
    private function withOrders(): Collection
    {
        $live = (new LiveOrdersOfRequisitionLines)(array_values($this->lines->pluck('id')->all()));

        return $this->lines->each(function (PurchaseRequisitionLine $line) use ($live): void {
            $line->setRelation('requisition', $this->resource);
            $line->setRelation('liveOrder', $live[$line->id] ?? null);
        });
    }
}
