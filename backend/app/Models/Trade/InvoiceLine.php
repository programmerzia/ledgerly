<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $invoice_id
 * @property int $line_no
 * @property string|null $item_id
 * @property string $account_id
 * @property string|null $description
 * @property string $quantity
 * @property int $unit_price_fc
 * @property string $discount_pct
 * @property string|null $tax_code_id
 * @property int $line_total_fc net of discount, before tax
 * @property int $tax_amount_fc
 * @property array<string, int> $tax_detail tax code id → this line's share of the tax
 * @property-read Invoice $invoice
 */
class InvoiceLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer', 'unit_price_fc' => 'integer', 'line_total_fc' => 'integer', 'tax_amount_fc' => 'integer', 'tax_detail' => 'array'];
    }

    /** @return BelongsTo<Invoice, $this> */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    /** The dimension value in slot $position, if any. */
    public function dimensionValue(int $position): ?string
    {
        $value = $this->getAttribute("dim{$position}_value_id");

        return is_string($value) ? $value : null;
    }
}
