<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\BillFromOrderInput;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Procurement\GoodsReceiptStatus;
use App\Domain\Procurement\LineFigures;
use App\Domain\Procurement\Quantity;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Trade\Invoice;
use App\Queries\Procurement\OrderLineFigures;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Makes an ordinary bill draft from an order or a receipt, through `CreateInvoiceDraft`, with each line pointing at its order
 * line. It copies what the order agreed and then behaves like a hand-made bill. Nothing is claimed until it is submitted.
 *
 * Quantities: from a receipt, what it brought in and is not billed yet; from an order, what was received and not billed, or,
 * if nothing was received at all, what was ordered (a bill that arrives first; the match will refuse it until goods arrive).
 */
final class CreateBillFromOrder
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly OrderLineFigures $figures,
        private readonly CreateInvoiceDraft $create,
    ) {}

    public function handle(Actor $actor, BillFromOrderInput $in): Invoice
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $order = PurchaseOrder::query()->with('lines')->findOrFail($in->orderId);
            $this->guard->require($actor, 'bills.create', $order->company_id, tokens: true);
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('bill_order_not_open', "A {$order->status->value} order takes no more bills.");
            }
            $figures = $this->figures->forOrder($order->id);
            $quantities = $in->receiptId === null ? $this->fromOrder($figures) : $this->fromReceipt($in->receiptId, $order, $figures);

            $lines = [];
            foreach ($order->lines as $line) {
                $quantity = $quantities[$line->id]['quantity'] ?? null;
                if ($quantity !== null) {
                    $lines[] = $this->billLine($line, $quantity, $quantities[$line->id]['receipt_line']);
                }
            }
            if ($lines === []) {
                throw DomainRuleViolation::single('order_nothing_to_bill', 'Everything here is already on a bill.');
            }

            return $this->create->handle($actor, new InvoiceDraftInput(
                companyId: $order->company_id, kind: InvoiceKind::PurchaseBill, contactId: $order->contact_id, issueDate: $in->issueDate, lines: $lines,
                dueDate: $in->dueDate, currency: $order->currency, fxRate: $in->fxRate, reference: $in->reference ?? $order->number,
            ));
        });
    }

    /**
     * @param  array<string, LineFigures>  $figures
     * @return array<string, array{quantity: string, receipt_line: string|null}>
     */
    private function fromOrder(array $figures): array
    {
        $received = [];
        $ordered = [];
        $anyReceived = false;
        foreach ($figures as $id => $f) {
            $anyReceived = $anyReceived || ! Quantity::isZero($f->received);
            if (! Quantity::isZero($f->receivedNotBilled())) {
                $received[$id] = ['quantity' => $f->receivedNotBilled(), 'receipt_line' => null];
            }
            if (! Quantity::isZero($f->notBilled())) {
                $ordered[$id] = ['quantity' => $f->notBilled(), 'receipt_line' => null];
            }
        }

        return $anyReceived ? $received : $ordered;
    }

    /**
     * @param  array<string, LineFigures>  $figures
     * @return array<string, array{quantity: string, receipt_line: string|null}>
     */
    private function fromReceipt(string $receiptId, PurchaseOrder $order, array $figures): array
    {
        $receipt = GoodsReceipt::query()->with('lines')->where('purchase_order_id', $order->id)->find($receiptId)
            ?? throw DomainRuleViolation::single('not_found', 'The receipt does not exist.');
        if ($receipt->status !== GoodsReceiptStatus::Recorded) {
            throw DomainRuleViolation::single('receipt_already_reversed', 'This receipt is reversed, so there is nothing to bill from it.');
        }
        $out = [];
        foreach ($receipt->lines as $line) {
            $open = $figures[$line->purchase_order_line_id]->receivedNotBilled();
            $quantity = Quantity::exceeds((string) $line->quantity, $open) ? $open : Quantity::normal((string) $line->quantity);
            if (! Quantity::isZero($quantity)) {
                $out[$line->purchase_order_line_id] = ['quantity' => $quantity, 'receipt_line' => $line->id];
            }
        }

        return $out;
    }

    private function billLine(PurchaseOrderLine $line, string $quantity, ?string $receiptLineId): InvoiceLineInput
    {
        $dims = [];
        for ($p = 1; $p <= 8; $p++) {
            $value = $line->dimensionValue($p);
            if ($value !== null) {
                $dims[$p] = $value;
            }
        }

        return new InvoiceLineInput(
            quantity: $quantity, itemId: $line->item_id, accountId: $line->account_id, description: $line->description, unitPriceFc: $line->unit_price_fc,
            taxCodeId: $line->tax_code_id, taxCodeGiven: true, dims: $dims, purchaseOrderLineId: $line->id, goodsReceiptLineId: $receiptLineId,
        );
    }
}
