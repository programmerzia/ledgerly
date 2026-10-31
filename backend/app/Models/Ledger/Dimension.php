<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $code
 * @property int $position
 * @property bool $is_active
 */
class Dimension extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['position' => 'integer', 'is_active' => 'boolean'];
    }
}
