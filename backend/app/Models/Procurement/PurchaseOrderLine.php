<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $company_id
 * @property string $purchase_order_id
 * @property int $line_no
 * @property string|null $requisition_line_id
 * @property string|null $item_id
 * @property string $account_id
 * @property string|null $description
 * @property string $quantity
 * @property int $unit_price_fc
 * @property string|null $tax_code_id
 * @property int $line_total_fc
 * @property int $tax_amount_fc
 * @property array<string, int> $tax_detail
 * @property-read PurchaseOrder $order
 */
class PurchaseOrderLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer', 'unit_price_fc' => 'integer', 'line_total_fc' => 'integer', 'tax_amount_fc' => 'integer', 'tax_detail' => 'array'];
    }

    /** @return BelongsTo<PurchaseOrder, $this> */
    public function order(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id');
    }

    /** The dimension value in slot $position, if any. */
    public function dimensionValue(int $position): ?string
    {
        $value = $this->getAttribute("dim{$position}_value_id");

        return is_string($value) ? $value : null;
    }
}
