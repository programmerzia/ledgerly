<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property string|null $parent_id
 * @property int $lock_version
 * @property string $dimension_id
 * @property string $code
 * @property bool $is_active
 * @property-read Dimension $dimension
 */
class DimensionValue extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'lock_version' => 'integer'];
    }

    /** @return BelongsTo<Dimension, $this> */
    public function dimension(): BelongsTo
    {
        return $this->belongsTo(Dimension::class);
    }
}
