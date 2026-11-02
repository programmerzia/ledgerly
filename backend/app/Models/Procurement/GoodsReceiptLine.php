<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $goods_receipt_id
 * @property string $purchase_order_line_id
 * @property int $line_no
 * @property string $quantity
 * @property-read PurchaseOrderLine $orderLine
 */
class GoodsReceiptLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer'];
    }

    /** @return BelongsTo<PurchaseOrderLine, $this> */
    public function orderLine(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrderLine::class, 'purchase_order_line_id');
    }
}
