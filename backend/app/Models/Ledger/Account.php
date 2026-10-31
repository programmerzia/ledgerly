<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property string $account_type
 * @property bool $is_postable
 * @property bool $is_active
 * @property bool $allow_manual_journals
 * @property ControlType $control_type
 * @property CurrencyPolicy $currency_policy
 * @property string|null $fixed_currency
 */
class Account extends BaseModel
{
    use SoftDeletes;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_postable' => 'boolean',
            'is_active' => 'boolean',
            'allow_manual_journals' => 'boolean',
            'control_type' => ControlType::class,
            'currency_policy' => CurrencyPolicy::class,
            'reporting_tags' => 'array',
        ];
    }

    /** @return HasMany<AccountDimensionRule, $this> */
    public function dimensionRules(): HasMany
    {
        return $this->hasMany(AccountDimensionRule::class);
    }
}
