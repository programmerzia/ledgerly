<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Domain\Ledger\DimensionRule;
use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $account_id
 * @property string $dimension_id
 * @property DimensionRule $rule
 * @property-read Dimension $dimension
 */
class AccountDimensionRule extends BaseModel
{
    public $timestamps = false;

    protected $primaryKey = 'account_id';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['rule' => DimensionRule::class];
    }

    /** @return BelongsTo<Dimension, $this> */
    public function dimension(): BelongsTo
    {
        return $this->belongsTo(Dimension::class);
    }
}
