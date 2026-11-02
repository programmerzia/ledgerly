<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * What the three-way match found at one submit of a bill. Append-only.
 *
 * @property string $id
 * @property string $invoice_id
 * @property string $outcome matched | overridden
 * @property list<array<string, mixed>> $violations
 * @property string|null $reason
 * @property string|null $decided_by
 * @property CarbonImmutable $created_at
 */
class BillMatchResult extends BaseModel
{
    public const null UPDATED_AT = null;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['violations' => 'array', 'created_at' => 'immutable_datetime'];
    }
}
