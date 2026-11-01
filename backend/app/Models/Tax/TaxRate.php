<?php

declare(strict_types=1);

namespace App\Models\Tax;

use App\Models\BaseModel;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $company_id
 * @property string $tax_code_id
 * @property string $rate a fraction, "0.050000" = 5%
 * @property Carbon $effective_from
 * @property Carbon|null $effective_to inclusive
 */
class TaxRate extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['effective_from' => 'date', 'effective_to' => 'date'];
    }
}
