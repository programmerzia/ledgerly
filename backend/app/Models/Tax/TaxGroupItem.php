<?php

declare(strict_types=1);

namespace App\Models\Tax;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $tax_group_id
 * @property string $tax_code_id
 * @property int $sequence 1-based position in the group
 * @property bool $compound charged on the net plus the taxes before it
 */
class TaxGroupItem extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['sequence' => 'integer', 'compound' => 'boolean'];
    }
}
