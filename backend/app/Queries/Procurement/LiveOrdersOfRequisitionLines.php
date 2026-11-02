<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Models\Procurement\PurchaseOrderLine;

/** For requisition lines: the order each is on, unless that order was cancelled (a cancelled order frees its lines). */
final class LiveOrdersOfRequisitionLines
{
    /**
     * @param  list<string>  $requisitionLineIds
     * @return array<string, array{id: string, number: string|null}> requisition line id → order
     */
    public function __invoke(array $requisitionLineIds): array
    {
        if ($requisitionLineIds === []) {
            return [];
        }
        $out = [];
        $lines = PurchaseOrderLine::query()->whereIn('requisition_line_id', $requisitionLineIds)
            ->whereHas('order', fn ($q) => $q->where('status', '<>', 'cancelled'))->with('order:id,number')->get();
        foreach ($lines as $line) {
            $out[(string) $line->requisition_line_id] = ['id' => $line->order->id, 'number' => $line->order->number];
        }

        return $out;
    }
}
