<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * Prefix and padding a document kind uses for every fiscal year that starts on or after `effective_from` (D15 item 6).
 *
 * @property string $id
 * @property string $company_id
 * @property string $doc_kind
 * @property string $prefix
 * @property int $padding
 * @property DateTimeImmutable $effective_from
 * @property int $lock_version
 */
class NumberingRule extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['padding' => 'integer', 'lock_version' => 'integer', 'effective_from' => 'immutable_date'];
    }
}
