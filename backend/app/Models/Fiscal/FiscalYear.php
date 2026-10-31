<?php

declare(strict_types=1);

namespace App\Models\Fiscal;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property DateTimeImmutable $starts_on
 * @property DateTimeImmutable $ends_on
 * @property string $status
 */
class FiscalYear extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['starts_on' => 'immutable_date', 'ends_on' => 'immutable_date'];
    }
}
