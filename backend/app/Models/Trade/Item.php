<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property string|null $description
 * @property string $kind service | good
 * @property string|null $sales_account_id
 * @property string|null $purchase_account_id
 * @property int $sales_price minor units of $currency
 * @property int $purchase_price minor units of $currency
 * @property string $currency
 * @property string|null $tax_code_id
 * @property bool $is_active
 * @property int $lock_version
 */
class Item extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['sales_price' => 'integer', 'purchase_price' => 'integer', 'is_active' => 'boolean', 'lock_version' => 'integer'];
    }
}
