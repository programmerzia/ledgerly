<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $company_id
 * @property string|null $bank_account_id
 * @property string $name
 * @property int $priority
 * @property array<string, mixed> $conditions contains, direction, min_amount, max_amount
 * @property array<string, mixed> $action account_id, tax_code_id, contact_id, dimensions, memo
 * @property bool $is_active
 * @property int $times_applied
 * @property int $lock_version
 */
class BankRule extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['conditions' => 'array', 'action' => 'array', 'is_active' => 'boolean', 'priority' => 'integer', 'times_applied' => 'integer', 'lock_version' => 'integer'];
    }
}
