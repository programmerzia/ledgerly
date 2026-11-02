<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $purchase_requisition_id
 * @property int $line_no
 * @property string|null $item_id
 * @property string|null $description
 * @property string $quantity
 * @property int $estimated_unit_price
 * @property int $line_total
 * @property string|null $account_id
 * @property CarbonImmutable|null $needed_by
 * @property-read PurchaseRequisition $requisition
 */
class PurchaseRequisitionLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer', 'estimated_unit_price' => 'integer', 'line_total' => 'integer', 'needed_by' => 'immutable_date'];
    }

    /** @return BelongsTo<PurchaseRequisition, $this> */
    public function requisition(): BelongsTo
    {
        return $this->belongsTo(PurchaseRequisition::class, 'purchase_requisition_id');
    }

    /** The dimension value in slot $position, if any. */
    public function dimensionValue(int $position): ?string
    {
        $value = $this->getAttribute("dim{$position}_value_id");

        return is_string($value) ? $value : null;
    }
}
