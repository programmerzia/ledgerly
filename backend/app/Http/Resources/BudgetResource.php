<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Budgets\Budget;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `revision` is the budget's version number within its fiscal year (1, 2, ...); `version` is the optimistic-lock counter every other
 * resource calls `version`, and it changes with every save of the budget's cells.
 *
 * @mixin Budget
 */
final class BudgetResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $year = $this->resource->relationLoaded('fiscalYear') ? $this->resource->fiscalYear : null;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'revision' => $this->version,
            'status' => $this->status,
            'fiscal_year' => $year === null ? null : ['id' => $year->id, 'name' => $year->name, 'starts_on' => Json::date($year->starts_on), 'ends_on' => Json::date($year->ends_on)],
            'fiscal_year_id' => $this->fiscal_year_id,
            'copied_from_id' => $this->copied_from_id,
            'created_by' => $this->created_by,
            'approved_by' => $this->approved_by,
            'approved_at' => Json::time($this->approved_at),
            'archived_at' => Json::time($this->archived_at),
            'line_count' => $this->when(isset($this->resource->lines_count), fn () => (int) $this->resource->lines_count),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'approve' => 'approve', 'archive' => 'archive', 'discard' => 'discard']),
        ];
    }
}
