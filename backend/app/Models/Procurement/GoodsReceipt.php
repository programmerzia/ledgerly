<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Domain\Procurement\GoodsReceiptStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string $purchase_order_id
 * @property string $number
 * @property GoodsReceiptStatus $status
 * @property CarbonImmutable $receipt_date
 * @property string|null $reference
 * @property string|null $memo
 * @property string|null $reversal_reason
 * @property string|null $reversed_by
 * @property CarbonImmutable|null $reversed_at
 * @property int $lock_version
 * @property string|null $created_by
 * @property-read Collection<int, GoodsReceiptLine> $lines
 * @property-read PurchaseOrder $order
 */
class GoodsReceipt extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['status' => GoodsReceiptStatus::class, 'receipt_date' => 'immutable_date', 'reversed_at' => 'immutable_datetime', 'lock_version' => 'integer'];
    }

    /** @return HasMany<GoodsReceiptLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class)->orderBy('line_no');
    }

    /** @return BelongsTo<PurchaseOrder, $this> */
    public function order(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id');
    }
}
