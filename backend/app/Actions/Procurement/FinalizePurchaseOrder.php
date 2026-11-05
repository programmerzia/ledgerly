<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseOrder;
use App\Services\Ledger\DocumentYear;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The last approval has been given (or no workflow applies): the order gets its gapless number and is approved. Called by
 * the workflow Actions through `Documents::post`, which have already checked maker, checker and signature. Posts nothing (D14).
 */
final class FinalizePurchaseOrder
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock, private readonly DocumentYear $years) {}

    public function handle(Actor $actor, string $orderId): PurchaseOrder
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $orderId) {
            $order = $locks->document(PurchaseOrder::query()->findOrFail($orderId));
            if (! in_array($order->status, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$order->status->value} order cannot be approved.");
            }
            [$key, $year] = $this->years->for($order->company_id, 'purchase_order', $order->order_date);
            $number = $locks->sequence($order->company_id, $key, "PO-{$year}-");

            $before = $order->attributesToArray();
            $order->forceFill([
                'status' => PurchaseOrderStatus::Approved, 'number' => $number, 'approved_at' => $this->clock->now(), 'lock_version' => $order->lock_version + 1,
            ])->save();

            $audit->add('purchase_order.approved', $order, before: $before, after: $order, context: ['number' => $number, 'by' => $actor->id]);
            $outbox->add(new ProcurementEvent('purchase_order.approved', $order->id, $order->company_id, $order->lock_version, ['number' => $number]));

            return $order;
        });
    }
}
