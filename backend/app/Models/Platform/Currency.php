<?php

declare(strict_types=1);

namespace App\Models\Platform;

use App\Models\BaseModel;

/**
 * @property string $code
 * @property string $name
 * @property int $minor_unit
 */
class Currency extends BaseModel
{
    public $timestamps = false;

    protected $primaryKey = 'code';
}
