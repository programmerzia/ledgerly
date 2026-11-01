<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property int $lock_version
 * @property string $code
 * @property int $position
 * @property bool $is_active
 * @property-read Collection<int, DimensionValue> $values
 */
class Dimension extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['position' => 'integer', 'is_active' => 'boolean', 'lock_version' => 'integer'];
    }

    /** @return HasMany<DimensionValue, $this> */
    public function values(): HasMany
    {
        return $this->hasMany(DimensionValue::class)->orderBy('code');
    }
}
