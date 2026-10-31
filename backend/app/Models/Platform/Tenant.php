<?php

declare(strict_types=1);

namespace App\Models\Platform;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $name
 * @property string $slug
 * @property string $lifecycle
 */
class Tenant extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['settings' => 'array', 'legal_hold' => 'boolean', 'archive_until' => 'immutable_date'];
    }
}
