<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Procurement\GoodsReceiptStatus;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\ReceiptRules;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\PurchaseOrder;
use App\Queries\Procurement\OrderLineFigures;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Reverses a receipt: order, then receipt (13 §8). It stays on file marked reversed and stops counting. Refused while its
 * quantity is on a pending or posted bill, because that bill matched against it: reverse or void the bill first.
 */
final class ReverseGoodsReceipt
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly OrderLineFigures $figures,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $receiptId, ?int $lockVersion, string $reason): GoodsReceipt
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a receipt.');
        }
        if (trim($reason) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the receipt is reversed.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $receiptId, $lockVersion, $reason) {
            $seen = GoodsReceipt::query()->findOrFail($receiptId);
            if (! $this->permissions->allows($actor, 'goods_receipts.reverse', $seen->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'You cannot reverse receipts in this company.');
            }
            $order = $locks->document(PurchaseOrder::query()->findOrFail($seen->purchase_order_id));
            $receipt = $locks->document($seen, $lockVersion)->load('lines');
            if ($receipt->status !== GoodsReceiptStatus::Recorded) {
                throw DomainRuleViolation::single('receipt_already_reversed', 'This receipt is already reversed.');
            }
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('order_not_open', "The order is {$order->status->value}, so its receipts can no longer be reversed.");
            }

            $figures = $this->figures->forOrder($order->id);
            $violations = [];
            foreach ($receipt->lines as $line) {
                $refused = ReceiptRules::reversal($figures[$line->purchase_order_line_id], (string) $line->quantity, $line->line_no);
                if ($refused !== null) {
                    $violations[] = $refused;
                }
            }
            if ($violations !== []) {
                throw PostingRejected::because($violations);
            }

            $before = $receipt->attributesToArray();
            $receipt->forceFill([
                'status' => GoodsReceiptStatus::Reversed, 'reversal_reason' => $reason, 'reversed_by' => $actor->id, 'reversed_at' => $this->clock->now(),
                'lock_version' => $receipt->lock_version + 1,
            ])->save();
            $order->forceFill(['status' => PurchaseOrderStatus::fromQuantities(array_values($this->figures->forOrder($order->id))), 'lock_version' => $order->lock_version + 1])->save();

            $audit->add('goods_receipt.reversed', $receipt, before: $before, after: $receipt, context: ['reason' => $reason, 'purchase_order_id' => $order->id]);
            $outbox->add(new ProcurementEvent('goods_receipt.reversed', $receipt->id, $order->company_id, $receipt->lock_version, ['number' => $receipt->number, 'purchase_order_id' => $order->id, 'reason' => $reason]));

            return $receipt;
        });
    }
}
