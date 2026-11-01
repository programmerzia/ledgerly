<?php

declare(strict_types=1);

namespace App\Models\Tax;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property string $kind
 * @property string|null $collect_account_id
 * @property string|null $pay_account_id
 * @property bool $is_recoverable
 * @property bool $is_active
 * @property int $lock_version
 * @property-read Collection<int, TaxRate> $rates
 */
class TaxCode extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_recoverable' => 'boolean', 'is_active' => 'boolean', 'lock_version' => 'integer'];
    }

    /** @return HasMany<TaxRate, $this> */
    public function rates(): HasMany
    {
        return $this->hasMany(TaxRate::class)->orderBy('effective_from');
    }
}
