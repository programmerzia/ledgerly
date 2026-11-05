<?php

declare(strict_types=1);

namespace App\Models\Transfers;

use App\Contracts\Postable;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * A transfer between two of the company's bank or cash accounts, in two legs through funds in transit (D15 item 3).
 * `status` is the shared document status (posted means the send leg is booked); `leg_state` says how far the money got.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $leg_state not_sent | in_transit | completed
 * @property string $from_bank_account_id
 * @property string $to_bank_account_id
 * @property DateTimeImmutable $send_date
 * @property string $from_currency
 * @property int $from_amount_fc
 * @property string $send_rate
 * @property int $send_base
 * @property int $fee_fc
 * @property string|null $fee_account_id
 * @property string $to_currency
 * @property int $to_amount_fc
 * @property string $receive_rate
 * @property int|null $receive_base
 * @property DateTimeImmutable|null $received_on
 * @property int|null $fx_difference
 * @property bool $settle_same_day
 * @property string|null $reference
 * @property string|null $memo
 * @property string|null $send_journal_id
 * @property string|null $receive_journal_id
 * @property string|null $send_reversal_journal_id
 * @property string|null $receive_reversal_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 */
class FundTransfer extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class, 'send_date' => 'immutable_date', 'received_on' => 'immutable_date', 'posted_at' => 'immutable_datetime',
            'from_amount_fc' => 'integer', 'send_base' => 'integer', 'fee_fc' => 'integer', 'to_amount_fc' => 'integer',
            'receive_base' => 'integer', 'fx_difference' => 'integer', 'settle_same_day' => 'boolean', 'lock_version' => 'integer',
        ];
    }

    public function documentType(): string
    {
        return 'fund_transfer';
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
        return $this->send_base;
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
            'id' => $this->id,
            'from_bank_account_id' => $this->from_bank_account_id,
            'to_bank_account_id' => $this->to_bank_account_id,
            'send_date' => $this->send_date->format('Y-m-d'),
            'from_currency' => $this->from_currency,
            'from_amount_fc' => $this->from_amount_fc,
            'send_rate' => (string) $this->send_rate,
            'fee_fc' => $this->fee_fc,
            'fee_account_id' => $this->fee_account_id,
            'to_currency' => $this->to_currency,
            'to_amount_fc' => $this->to_amount_fc,
            'receive_rate' => (string) $this->receive_rate,
            'settle_same_day' => $this->settle_same_day,
            'reference' => $this->reference,
            'memo' => $this->memo,
        ];
    }
}
