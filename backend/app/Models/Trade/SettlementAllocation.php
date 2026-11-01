<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;

/**
 * One allocation of a settlement to a document (`invoice_id`) or, for a refund of credit on account, to another
 * settlement's credit (`source_settlement_id`). `amount` (carried base) and `fx_gain_loss` are fixed when it posts.
 *
 * @property string $id
 * @property string $settlement_id
 * @property string|null $invoice_id
 * @property string|null $source_settlement_id
 * @property int $amount_fc
 * @property int $amount
 * @property int $fx_gain_loss
 */
class SettlementAllocation extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount_fc' => 'integer', 'amount' => 'integer', 'fx_gain_loss' => 'integer'];
    }
}
