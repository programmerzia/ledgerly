<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $match_id
 * @property string|null $statement_line_id
 * @property string|null $journal_line_id
 * @property string|null $settlement_id
 * @property int $amount
 */
class BankMatchItem extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount' => 'integer'];
    }
}
