<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string $bank_account_id
 * @property int $amount
 * @property string|null $matched_by
 * @property DateTimeImmutable $matched_at
 * @property string|null $reconciliation_id set while a finished reconciliation covers the match
 */
class BankMatch extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount' => 'integer', 'matched_at' => 'immutable_datetime'];
    }

    /** @return HasMany<BankMatchItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(BankMatchItem::class, 'match_id');
    }
}
