<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Domain\Ledger\DraftLine;
use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $journal_id
 * @property int $line_no
 * @property string $account_id
 * @property int $debit
 * @property int $credit
 * @property string $currency
 * @property string $fx_rate
 * @property int $amount_fc
 * @property string|null $description
 * @property string|null $contact_id
 * @property string|null $tax_code_id
 * @property string|null $due_date
 */
class JournalLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['debit' => 'integer', 'credit' => 'integer', 'amount_fc' => 'integer', 'line_no' => 'integer'];
    }

    /** Rebuild the Domain line, treating base-currency lines as having no fc data. */
    public function toDraftLine(string $baseCurrency): DraftLine
    {
        $dims = [];
        for ($p = 1; $p <= 8; $p++) {
            $value = $this->getAttribute("dim{$p}_value_id");
            $dims[$p] = is_string($value) ? $value : null;
        }
        $foreign = $this->currency !== $baseCurrency;

        return new DraftLine(
            accountId: $this->account_id,
            debit: $this->debit,
            credit: $this->credit,
            currency: $this->currency,
            fxRate: $foreign ? $this->fx_rate : null,
            amountFc: $foreign ? $this->amount_fc : null,
            dims: $dims,
            description: $this->description,
            contactId: $this->contact_id,
            taxCodeId: $this->tax_code_id,
            dueDate: $this->due_date,
        );
    }
}
