<?php

declare(strict_types=1);

namespace App\Models\Workflow;

use App\Models\BaseModel;
use App\Models\Ledger\Journal;
use App\Models\Platform\User;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Trade\Invoice;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Models\Transfers\FundTransfer;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One required signature of one document (a workflow step snapshot, per slot).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $document_type
 * @property string $document_id
 * @property string|null $workflow_id
 * @property int $step
 * @property int $slot
 * @property string $role
 * @property string $status
 * @property string|null $requested_by
 * @property CarbonImmutable $requested_at
 * @property string|null $decided_by
 * @property CarbonImmutable|null $decided_at
 * @property string|null $comment
 * @property string|null $signed_by
 * @property CarbonImmutable|null $signed_at
 * @property string|null $signature_hash
 * @property-read Journal $journal
 */
class ApprovalRequest extends BaseModel
{
    /** requested_at / decided_at / signed_at are the meaningful times; no Laravel timestamps. */
    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['step' => 'integer', 'slot' => 'integer', 'requested_at' => 'immutable_datetime', 'decided_at' => 'immutable_datetime', 'signed_at' => 'immutable_datetime'];
    }

    /**
     * The journal this request is for (the only document type so far).
     *
     * @return BelongsTo<Journal, $this>
     */
    public function journal(): BelongsTo
    {
        return $this->belongsTo(Journal::class, 'document_id');
    }

    /** @return BelongsTo<PurchaseRequisition, $this> */
    public function purchaseRequisition(): BelongsTo
    {
        return $this->belongsTo(PurchaseRequisition::class, 'document_id');
    }

    /** @return BelongsTo<PurchaseOrder, $this> */
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'document_id');
    }

    /** @return BelongsTo<PurchaseOrderRevision, $this> */
    public function orderRevision(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrderRevision::class, 'document_id');
    }

    /** @return BelongsTo<User, $this> */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    /** @return BelongsTo<Invoice, $this> null unless the document is an invoice or bill */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class, 'document_id');
    }

    /** @return BelongsTo<Settlement, $this> null unless the document is a settlement */
    public function settlement(): BelongsTo
    {
        return $this->belongsTo(Settlement::class, 'document_id');
    }

    /** @return BelongsTo<FundTransfer, $this> null unless the document is a fund transfer */
    public function fundTransfer(): BelongsTo
    {
        return $this->belongsTo(FundTransfer::class, 'document_id');
    }

    /** @return BelongsTo<PaymentRun, $this> null unless the document is a payment run */
    public function paymentRun(): BelongsTo
    {
        return $this->belongsTo(PaymentRun::class, 'document_id');
    }
}
