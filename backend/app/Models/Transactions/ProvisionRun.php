<?php

declare(strict_types=1);

namespace App\Models\Transactions;

use App\Contracts\Postable;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * A bad-debt provisioning run for one period (D15 item 2): required allowance by aging bucket, the allowance held, the
 * difference that posts. `detail` keeps the buckets, rates and balances the numbers came from.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $fiscal_period_id
 * @property DateTimeImmutable $as_of
 * @property int $required
 * @property int $existing
 * @property int $difference
 * @property array<string, mixed> $detail
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
class ProvisionRun extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class, 'as_of' => 'immutable_date', 'posted_at' => 'immutable_datetime', 'detail' => 'array',
            'required' => 'integer', 'existing' => 'integer', 'difference' => 'integer', 'lock_version' => 'integer',
        ];
    }

    public function documentType(): string
    {
        return 'provision_run';
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
        return abs($this->difference);
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
            'id' => $this->id, 'as_of' => $this->as_of->format('Y-m-d'), 'required' => $this->required, 'existing' => $this->existing,
            'difference' => $this->difference, 'detail' => $this->detail, 'memo' => $this->memo,
        ];
    }
}
