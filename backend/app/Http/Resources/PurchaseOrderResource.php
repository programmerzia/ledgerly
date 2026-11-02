<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Procurement\RevisionStatus;
use App\Http\Support\Json;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Queries\Procurement\OrderLineFigures;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A purchase order. `*_fc` amounts are in the order `currency`, the others in the company's base currency. `revision` is
 * the number of the last applied revision; `open_revision_id` (one order only) names the revision waiting, if any.
 * The list answers summaries; one order comes with its lines and their received and billed quantities.
 *
 * @mixin PurchaseOrder
 */
final class PurchaseOrderResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        $cur = $this->currency;
        $withLines = $this->resource->relationLoaded('lines');

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'contact_id' => $this->contact_id,
            'contact_name' => $this->resource->relationLoaded('contact') ? $this->contact->name : null,
            'order_date' => Json::date($this->order_date),
            'expected_date' => Json::date($this->expected_date),
            'currency' => $cur,
            'fx_rate' => (string) $this->fx_rate,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'subtotal_fc' => Json::money($this->subtotal_fc, $cur),
            'tax_total_fc' => Json::money($this->tax_total_fc, $cur),
            'total_fc' => Json::money($this->total_fc, $cur),
            'subtotal' => Json::money($this->subtotal, $base),
            'tax_total' => Json::money($this->tax_total, $base),
            'total' => Json::money($this->total, $base),
            'revision' => $this->revision,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'approved_at' => Json::time($this->approved_at),
            'cancelled_at' => Json::time($this->cancelled_at),
            'cancel_reason' => $this->cancel_reason,
            'closed_at' => Json::time($this->closed_at),
            'version' => $this->lock_version,
            'lines' => $this->whenLoaded('lines', fn () => PurchaseOrderLineResource::collection($this->withFigures())),
            /** Only on one order: the draft or pending revision, if there is one. */
            'open_revision_id' => $this->when($withLines, fn (): ?string => $this->openRevisionId()),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return',
                'cancel' => 'cancel', 'close' => 'close', 'revise' => 'revise', 'receive' => 'receive', 'bill' => 'bill',
            ]),
        ];
    }

    /** @return Collection<int, PurchaseOrderLine> */
    private function withFigures(): Collection
    {
        $figures = (new OrderLineFigures)->forOrder($this->id);

        return $this->lines->each(function (PurchaseOrderLine $line) use ($figures): void {
            $line->setRelation('order', $this->resource);
            $line->setRelation('figures', $figures[$line->id] ?? null);
        });
    }

    private function openRevisionId(): ?string
    {
        $id = PurchaseOrderRevision::query()->where('purchase_order_id', $this->id)
            ->whereIn('status', [RevisionStatus::Draft->value, RevisionStatus::PendingApproval->value])->value('id');

        return is_string($id) ? $id : null;
    }
}
