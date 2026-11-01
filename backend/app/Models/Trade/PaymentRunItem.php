<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $payment_run_id
 * @property int $line_no
 * @property string $invoice_id
 * @property string $contact_id
 * @property int $amount_fc
 * @property int $wht_amount_fc
 */
class PaymentRunItem extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount_fc' => 'integer', 'wht_amount_fc' => 'integer', 'line_no' => 'integer'];
    }
}
