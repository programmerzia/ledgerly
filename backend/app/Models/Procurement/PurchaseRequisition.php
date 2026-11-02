<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Contracts\Postable;
use App\Domain\Procurement\RequisitionStatus;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property RequisitionStatus $status
 * @property CarbonImmutable $requisition_date
 * @property string $currency
 * @property string|null $memo
 * @property int $total
 * @property string|null $rejection_reason
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property CarbonImmutable|null $approved_at
 * @property-read Collection<int, PurchaseRequisitionLine> $lines
 */
class PurchaseRequisition extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => RequisitionStatus::class, 'requisition_date' => 'immutable_date', 'approved_at' => 'immutable_datetime',
            'total' => 'integer', 'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<PurchaseRequisitionLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseRequisitionLine::class)->orderBy('line_no');
    }

    public function documentType(): string
    {
        return 'purchase_requisition';
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
        return $this->status->documentStatus();
    }

    public function documentAmount(): int
    {
        return $this->total;
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
            'requisition_date' => $this->requisition_date->format('Y-m-d'),
            'currency' => $this->currency,
            'memo' => $this->memo,
            'total' => $this->total,
            'lines' => $this->lines->map(fn (PurchaseRequisitionLine $l) => [
                'line_no' => $l->line_no, 'item_id' => $l->item_id, 'description' => $l->description, 'quantity' => (string) $l->quantity,
                'estimated_unit_price' => $l->estimated_unit_price, 'account_id' => $l->account_id, 'needed_by' => $l->needed_by?->format('Y-m-d'),
                'dims' => array_map(fn (int $p) => $l->dimensionValue($p), range(1, 8)),
            ])->values()->all(),
        ];
    }
}
