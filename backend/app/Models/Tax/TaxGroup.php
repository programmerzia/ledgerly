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
 * @property bool $is_active
 * @property int $lock_version
 * @property-read Collection<int, TaxGroupItem> $items
 */
class TaxGroup extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'lock_version' => 'integer'];
    }

    /** @return HasMany<TaxGroupItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(TaxGroupItem::class)->orderBy('sequence');
    }
}
