<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Contracts\Postable;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A proposed change to an approved order. Its own document, so the order stays as approved until this is approved too.
 *
 * @property string $id
 * @property string $company_id
 * @property string $purchase_order_id
 * @property int|null $revision_no
 * @property RevisionStatus $status
 * @property string $reason
 * @property array<string, mixed> $proposed
 * @property int $total
 * @property array<string, mixed>|null $before
 * @property array<string, mixed>|null $after
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property CarbonImmutable|null $applied_at
 * @property-read PurchaseOrder $order
 */
class PurchaseOrderRevision extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => RevisionStatus::class, 'proposed' => 'array', 'before' => 'array', 'after' => 'array',
            'total' => 'integer', 'revision_no' => 'integer', 'lock_version' => 'integer', 'applied_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<PurchaseOrder, $this> */
    public function order(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id');
    }

    public function documentType(): string
    {
        return 'purchase_order_revision';
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
        return ['id' => $this->id, 'purchase_order_id' => $this->purchase_order_id, 'reason' => $this->reason, 'proposed' => $this->proposed, 'total' => $this->total];
    }
}
