<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;

/**
 * @property string $company_id
 * @property array<string, string> $posting_accounts key → account id (older rows may hold an account code)
 * @property array<string, mixed> $numbering
 * @property string $tax_rounding document_per_code | line
 */
class CompanySettings extends BaseModel
{
    protected $table = 'company_settings';

    protected $primaryKey = 'company_id';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['posting_accounts' => 'array', 'numbering' => 'array', 'approval_defaults' => 'array', 'document_templates' => 'array'];
    }
}
