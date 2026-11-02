<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\GoodsReceiptInput;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Procurement\GoodsReceiptStatus;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\Quantity;
use App\Domain\Procurement\ReceiptRules;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\GoodsReceiptLine;
use App\Models\Procurement\PurchaseOrder;
use App\Queries\Procurement\OrderLineFigures;
use App\Queries\Procurement\ProcurementSettings;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Records goods received or a service confirmed, against one order's lines. Final the moment it is recorded: there is no
 * draft and no edit, only a reversal. Order, then number (13 §8), so the open quantity it checks cannot move. Posts nothing (D14).
 */
final class RecordGoodsReceipt
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly OrderLineFigures $figures,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, GoodsReceiptInput $in): GoodsReceipt
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = PurchaseOrder::query()->where('company_id', $in->companyId)->find($in->orderId)
                ?? throw DomainRuleViolation::single('not_found', 'The order does not exist.');
            $this->guard->require($actor, 'goods_receipts.create', $seen->company_id, tokens: true);
            $order = $locks->document($seen, $in->orderVersion)->load('lines');
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('order_not_open', "A {$order->status->value} order takes no receipts.");
            }
            if ($in->lines === []) {
                throw DomainRuleViolation::single('document_lines_missing', 'A receipt needs at least one line.');
            }

            $figures = $this->figures->forOrder($order->id);
            $tolerance = ProcurementSettings::of($order->company_id)->receiptTolerancePct;
            $violations = [];
            $seenLines = [];
            foreach ($in->lines as $i => $line) {
                $lineNo = $i + 1;
                $f = $figures[$line->orderLineId] ?? null;
                if ($f === null) {
                    $violations[] = new Violation('receipt_line_invalid', "Line {$lineNo} is not on this order.", $lineNo);

                    continue;
                }
                if (isset($seenLines[$line->orderLineId])) {
                    $violations[] = new Violation('receipt_line_invalid', "Line {$lineNo} repeats an order line.", $lineNo);
                }
                $seenLines[$line->orderLineId] = true;
                if (Quantity::isZero($line->quantity)) {
                    $violations[] = new Violation('receipt_line_invalid', "Line {$lineNo} has no quantity.", $lineNo);
                }
                $over = ReceiptRules::overReceipt($f, $line->quantity, $tolerance, $lineNo);
                if ($over !== null) {
                    $violations[] = $over;
                }
            }
            if ($violations !== []) {
                throw PostingRejected::because($violations);
            }

            $year = $in->receiptDate->format('Y');
            $number = $locks->sequence($order->company_id, "doc:goods_receipt:{$year}", "GRN-{$year}-");
            $receipt = new GoodsReceipt;
            $receipt->forceFill([
                'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $order->company_id, 'purchase_order_id' => $order->id,
                'number' => $number, 'status' => GoodsReceiptStatus::Recorded, 'receipt_date' => $in->receiptDate,
                'reference' => $in->reference, 'memo' => $in->memo, 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            foreach ($in->lines as $i => $line) {
                (new GoodsReceiptLine)->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $order->company_id, 'goods_receipt_id' => $receipt->id,
                    'purchase_order_line_id' => $line->orderLineId, 'line_no' => $i + 1, 'quantity' => Quantity::normal($line->quantity),
                ])->save();
            }

            $statusBefore = $order->status->value;
            $order->forceFill(['status' => PurchaseOrderStatus::fromQuantities(array_values($this->figures->forOrder($order->id))), 'lock_version' => $order->lock_version + 1])->save();

            $audit->add('goods_receipt.recorded', $receipt, after: $receipt, context: ['purchase_order_id' => $order->id, 'number' => $number, 'order_before' => $statusBefore, 'order_after' => $order->status->value]);
            $outbox->add(new ProcurementEvent('goods_receipt.recorded', $receipt->id, $order->company_id, $receipt->lock_version, ['number' => $number, 'purchase_order_id' => $order->id]));

            return $receipt;
        });
    }
}
