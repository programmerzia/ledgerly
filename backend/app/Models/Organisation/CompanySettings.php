<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;

/** @property string $company_id */
class CompanySettings extends BaseModel
{
    protected $table = 'company_settings';

    protected $primaryKey = 'company_id';
}
