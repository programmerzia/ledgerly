<?php

declare(strict_types=1);

namespace App\Models\Transactions;

use App\Contracts\Postable;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * A customer write-off against one posted invoice (D15 item 2). `amount_fc` is in the invoice's currency, `amount` the base
 * carried; `allowance_used` + `expense` = `amount`.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $invoice_id
 * @property string $contact_id
 * @property DateTimeImmutable $write_off_date
 * @property string $currency
 * @property string $fx_rate
 * @property int $amount_fc
 * @property int $amount
 * @property int $allowance_used
 * @property int $expense
 * @property int $recovered_fc
 * @property string $reason
 * @property string|null $reference
 * @property string|null $memo
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 */
class WriteOff extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class, 'write_off_date' => 'immutable_date', 'posted_at' => 'immutable_datetime',
            'amount_fc' => 'integer', 'amount' => 'integer', 'allowance_used' => 'integer', 'expense' => 'integer',
            'recovered_fc' => 'integer', 'lock_version' => 'integer',
        ];
    }

    public function documentType(): string
    {
        return 'write_off';
    }

    public function documentId(): string
    {
        return $this->id;
    }

    public function documentCompanyId(): string
    {
        return $this->company_id;
    }

    public function documentStatus(): DocumentStatus
    {
        return $this->status;
    }

    public function documentAmount(): int
    {
        return $this->amount;
    }

    public function documentCreatedBy(): ?string
    {
        return $this->created_by;
    }

    public function documentSubmittedBy(): ?string
    {
        return $this->submitted_by;
    }

    public function documentLockVersion(): int
    {
        return $this->lock_version;
    }

    public function documentContent(): array
    {
        return [
            'id' => $this->id, 'invoice_id' => $this->invoice_id, 'write_off_date' => $this->write_off_date->format('Y-m-d'),
            'amount_fc' => $this->amount_fc, 'reason' => $this->reason, 'reference' => $this->reference, 'memo' => $this->memo,
        ];
    }
}
