<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use App\Models\Ledger\Journal;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A spend, receive or transfer coded from a statement line. Its state is its journal's: pending_approval, posted, ...
 *
 * @property string $id
 * @property string $company_id
 * @property string $bank_account_id
 * @property string $statement_line_id
 * @property string $journal_id
 * @property string $kind spend|receive|transfer
 * @property string|null $to_bank_account_id
 * @property string|null $rule_id
 * @property int $gross
 * @property string $currency
 * @property string|null $created_by
 */
class BankTransaction extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['gross' => 'integer'];
    }

    /** @return BelongsTo<Journal, $this> */
    public function journal(): BelongsTo
    {
        return $this->belongsTo(Journal::class);
    }
}
