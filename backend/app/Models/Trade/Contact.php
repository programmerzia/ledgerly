<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $company_id
 * @property string $kind customer | supplier | both
 * @property string $code
 * @property string $name
 * @property string|null $legal_name
 * @property string|null $tax_id
 * @property string|null $email
 * @property string|null $phone
 * @property array<string, mixed>|null $billing_address
 * @property array<string, mixed>|null $shipping_address
 * @property string $default_currency
 * @property int $payment_terms_days
 * @property int|null $credit_limit minor units of the default currency
 * @property string|null $ar_account_id
 * @property string|null $ap_account_id
 * @property string|null $wht_code_id
 * @property string|null $default_account_id
 * @property string|null $default_tax_code_id
 * @property string|null $default_branch
 * @property array<string, string> $default_dims dimension id → value id
 * @property bool $is_active
 * @property string|null $notes
 * @property bool $dunning_opt_out
 * @property int $lock_version
 */
class Contact extends BaseModel
{
    use SoftDeletes;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'billing_address' => 'array', 'shipping_address' => 'array', 'default_dims' => 'array',
            'payment_terms_days' => 'integer', 'credit_limit' => 'integer', 'is_active' => 'boolean', 'dunning_opt_out' => 'boolean', 'lock_version' => 'integer',
        ];
    }
}
