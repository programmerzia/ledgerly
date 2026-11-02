<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\RevisionInput;
use App\Contracts\IdGenerator;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Services\Procurement\RevisionPayload;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Opens a draft revision of an approved order. The order itself does not change until the revision is approved. One open revision per order. */
final class CreateOrderRevision
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly IdGenerator $ids, private readonly RevisionPayload $payload) {}

    public function handle(Actor $actor, string $orderId, ?int $orderVersion, RevisionInput $in): PurchaseOrderRevision
    {
        if (trim($in->reason) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the order is being revised.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $orderId, $orderVersion, $in) {
            $seen = PurchaseOrder::query()->findOrFail($orderId);
            $this->guard->require($actor, 'purchase_orders.create', $seen->company_id, tokens: true);
            $order = $locks->document($seen, $orderVersion);
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('order_not_open', "A {$order->status->value} order cannot be revised.");
            }
            if (PurchaseOrderRevision::query()->where('purchase_order_id', $order->id)->whereIn('status', [RevisionStatus::Draft->value, RevisionStatus::PendingApproval->value])->exists()) {
                throw DomainRuleViolation::single('order_has_open_revision', 'This order already has a revision in progress.');
            }

            $computed = $this->payload->price($order, $in);
            $revision = new PurchaseOrderRevision;
            $revision->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $order->company_id, 'purchase_order_id' => $order->id,
                'status' => RevisionStatus::Draft, 'reason' => $in->reason, 'proposed' => $this->payload->toProposed($in, $computed), 'total' => $computed->total,
                'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();

            $audit->add('purchase_order_revision.created', $revision, after: $revision, context: ['purchase_order_id' => $order->id]);

            return $revision;
        });
    }
}
