<?php

declare(strict_types=1);

namespace App\Models\Budgets;

use App\Models\BaseModel;

/**
 * One budget cell: account x regular period x dimension values, in base-currency minor units (natural direction).
 *
 * @property string $id
 * @property string $budget_id
 * @property string $account_id
 * @property string $fiscal_period_id
 * @property int $amount
 */
class BudgetLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount' => 'integer'];
    }
}
