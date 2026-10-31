<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Models\BaseModel;

/**
 * Read model of the balance projection (13 §9). Rows are written only by `LockSet::balances`;
 * the composite key means Eloquent never updates them through this model.
 *
 * @property string $account_id
 * @property string $fiscal_period_id
 * @property int $debit
 * @property int $credit
 */
class AccountPeriodBalance extends BaseModel
{
    protected $table = 'account_period_balances';

    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['debit' => 'integer', 'credit' => 'integer'];
    }
}
