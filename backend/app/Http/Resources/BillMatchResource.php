<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\Procurement\BillMatchView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * How a bill stands against its purchase orders right now, and what the last submit found.
 *
 * @mixin BillMatchView
 */
final class BillMatchResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $last = $this->last;

        return [
            /** False: a bill with no order lines, in a company that does not require them. */
            'applies' => $this->applies,
            /** Never overridable: fix the bill. */
            'refusals' => $this->refusals,
            /** A person allowed to may override these with a reason. */
            'mismatches' => $this->mismatches,
            /** @var list<array{line_no: int, purchase_order_id: string, order_line_id: string, order_number: string|null, order_price_fc: array{amount: int, currency: string}, ordered: string, received: string, billed_elsewhere: string}> */
            'lines' => array_map(fn (array $l) => [...$l, 'order_price_fc' => Json::money($l['order_price_fc'], $this->currency)], $this->lines),
            /** @var array{outcome: string, reason: string|null, violations: list<array<string, mixed>>, decided_by: string|null, created_at: string|null}|null */
            'last_result' => $last === null ? null : [
                'outcome' => $last->outcome,
                'reason' => $last->reason,
                'violations' => $last->violations,
                'decided_by' => $last->decided_by,
                'created_at' => Json::time($last->created_at),
            ],
        ];
    }
}
