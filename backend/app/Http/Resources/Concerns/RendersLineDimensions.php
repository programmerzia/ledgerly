<?php

declare(strict_types=1);

namespace App\Http\Resources\Concerns;

use App\Http\Support\Json;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Procurement\PurchaseRequisitionLine;
use App\Queries\Ledger\DimensionPositions;
use Illuminate\Http\Request;

/** A line's dimension values as `{dimension id: value id}`; the company's dimension positions are read once per request. */
trait RendersLineDimensions
{
    /** @return array<string, string> */
    private function lineDimensions(Request $request, PurchaseOrderLine|PurchaseRequisitionLine $line): array
    {
        /** @var array<int, string>|null $positions */
        $positions = $request->attributes->get('dimension_positions');
        if ($positions === null) {
            $positions = (new DimensionPositions)(Json::company($request)->id);
            $request->attributes->set('dimension_positions', $positions);
        }
        $out = [];
        foreach ($positions as $position => $dimensionId) {
            $valueId = $line->dimensionValue($position);
            if ($valueId !== null) {
                $out[$dimensionId] = $valueId;
            }
        }

        return $out;
    }
}
