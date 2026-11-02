<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Services\Procurement\OrderPricing;
use App\Services\Procurement\OrderWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft's header and lines, guarded by lock_version. A kept line keeps its id and its link to the requisition. */
final class UpdatePurchaseOrderDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly OrderPricing $pricing,
        private readonly OrderWriter $writer,
    ) {}

    public function handle(Actor $actor, string $orderId, int $lockVersion, OrderDraftInput $in): PurchaseOrder
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $orderId, $lockVersion, $in) {
            $seen = PurchaseOrder::query()->findOrFail($orderId);
            $this->guard->require($actor, 'purchase_orders.create', $seen->company_id, tokens: true);
            $order = $locks->document($seen, $lockVersion);
            if ($order->status !== PurchaseOrderStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited; an approved order changes through a revision.');
            }

            $existing = PurchaseOrderLine::query()->where('purchase_order_id', $order->id)->pluck('requisition_line_id', 'id')->all();
            $lines = array_map(function (OrderLineInput $line) use ($existing): OrderLineInput {
                if ($line->id !== null && ! array_key_exists($line->id, $existing)) {
                    throw DomainRuleViolation::single('order_line_unknown', 'A line on the form is not on this order.');
                }

                return $line->withRequisitionLine($line->id === null ? null : $existing[$line->id]);
            }, $in->lines);

            $computed = $this->pricing->compute($in);
            $before = $order->attributesToArray();
            PurchaseOrderLine::query()->where('purchase_order_id', $order->id)->delete();
            $order->forceFill([...$this->writer->header($in, $computed), 'lock_version' => $order->lock_version + 1])->save();
            $this->writer->insertLines($actor, $order, $lines, $computed);

            $audit->add('purchase_order.updated', $order, before: $before, after: $order, context: ['lines' => count($computed->lines)]);

            return $order;
        });
    }
}
