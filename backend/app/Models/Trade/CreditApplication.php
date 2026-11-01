<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * Credit applied later to an open document (D9): the credit on account of a settlement (`settlement_id`) or a
 * posted credit or debit note (`note_id`). Never edited; undoing it stamps `reversed_at`.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $settlement_id
 * @property string|null $note_id
 * @property string $invoice_id
 * @property int $amount_fc
 * @property int $source_amount
 * @property int $amount
 * @property int $fx_gain_loss
 * @property DateTimeImmutable $applied_on
 * @property string $journal_id
 * @property string|null $reversal_journal_id
 * @property DateTimeImmutable|null $reversed_at
 * @property string|null $created_by
 */
class CreditApplication extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'amount_fc' => 'integer', 'source_amount' => 'integer', 'amount' => 'integer', 'fx_gain_loss' => 'integer',
            'applied_on' => 'immutable_date', 'reversed_at' => 'immutable_datetime',
        ];
    }
}
