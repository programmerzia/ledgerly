<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Procurement\GoodsReceiptLine;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use Illuminate\Database\DatabaseManager;

/** Writes a priced draft: the header columns, the lines (one multi-row insert) and the link to the document a note refers to. */
final class InvoiceWriter
{
    public function __construct(
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    /** @return array<string, mixed> */
    public function header(InvoiceDraftInput $in, ComputedDocument $c): array
    {
        return [
            'contact_id' => $in->contactId,
            'issue_date' => $in->issueDate,
            'due_date' => $c->dueDate,
            'currency' => $c->currency,
            'fx_rate' => $c->fxRate,
            'reference' => $in->reference,
            'memo' => $in->memo,
            'subtotal_fc' => $c->subtotalFc, 'tax_total_fc' => $c->taxTotalFc, 'total_fc' => $c->totalFc,
            'subtotal' => $c->subtotal, 'tax_total' => $c->taxTotal, 'total' => $c->total,
            'reverse_charge_total_fc' => $c->reverseChargeFc, 'reverse_charge_total' => $c->reverseCharge,
            'wht_code_id' => $c->whtCodeId, 'wht_amount_fc' => $c->whtAmountFc, 'wht_amount' => $c->whtAmount,
            'related_invoice_id' => $in->relatedInvoiceId,
        ];
    }

    /**
     * A credit or debit note refers to a posted document of its parent kind, for the same counterparty and in the
     * same currency. (The note may exceed the original's total only as far as later settlement allows; see the report.)
     */
    public function checkRelated(InvoiceDraftInput $in, ComputedDocument $c): void
    {
        $this->checkOrderLinks($in, $c);
        if ($in->relatedInvoiceId === null) {
            return;
        }
        if (! $in->kind->isNote()) {
            throw DomainRuleViolation::single('related_document_invalid', 'Only a credit note or a debit note refers to another document.');
        }
        $related = Invoice::query()->where('company_id', $in->companyId)->find($in->relatedInvoiceId)
            ?? throw DomainRuleViolation::single('not_found', 'The document the note refers to does not exist.');
        if ($related->kind !== $in->kind->parent() || $related->contact_id !== $in->contactId || $related->currency !== $c->currency) {
            throw DomainRuleViolation::single('related_document_invalid', 'A '.$in->kind->label().' must refer to a '.$in->kind->parent()?->label().' of the same contact and currency.');
        }
        if ($related->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('related_document_not_posted', 'The document the note refers to is not posted.');
        }
    }

    /**
     * A bill line may point at a line of an open order with the same supplier and currency, and at a receipt line of that order
     * line. Fails early here; the match checks the order's state again at submit. Documents with no links run no query.
     */
    private function checkOrderLinks(InvoiceDraftInput $in, ComputedDocument $c): void
    {
        $links = array_values(array_filter($c->lines, fn (ComputedLine $l) => $l->purchaseOrderLineId !== null || $l->goodsReceiptLineId !== null));
        if ($links === []) {
            return;
        }
        if ($in->kind !== InvoiceKind::PurchaseBill) {
            throw DomainRuleViolation::single('order_link_invalid', 'Only a bill can refer to a purchase order.');
        }
        foreach ($links as $line) {
            $orderLine = $line->purchaseOrderLineId === null ? null : PurchaseOrderLine::query()->with('order')->where('company_id', $in->companyId)->find($line->purchaseOrderLineId);
            if ($orderLine === null) {
                throw DomainRuleViolation::single('order_link_invalid', 'A bill line refers to an order line that does not exist.');
            }
            $order = $orderLine->order;
            if ($order->contact_id !== $in->contactId) {
                throw DomainRuleViolation::single('bill_order_supplier_mismatch', 'A bill line refers to an order with a different supplier.');
            }
            if ($order->currency !== $c->currency) {
                throw DomainRuleViolation::single('bill_order_currency_mismatch', "A bill line refers to an order in {$order->currency}, not {$c->currency}.");
            }
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('bill_order_not_open', "A {$order->status->value} order takes no more bills.");
            }
            if ($line->goodsReceiptLineId !== null
                && ! GoodsReceiptLine::query()->whereKey($line->goodsReceiptLineId)->where('purchase_order_line_id', $orderLine->id)->exists()) {
                throw DomainRuleViolation::single('order_link_invalid', 'A bill line refers to a receipt of a different order line.');
            }
        }
    }

    public function insertLines(Actor $actor, Invoice $invoice, ComputedDocument $c): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $rows = [];
        foreach ($c->lines as $i => $line) {
            $row = [
                'id' => $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'company_id' => $invoice->company_id,
                'invoice_id' => $invoice->id,
                'line_no' => $i + 1,
                'item_id' => $line->itemId,
                'account_id' => $line->accountId,
                'description' => $line->description,
                'quantity' => $line->quantity,
                'unit_price_fc' => $line->unitPriceFc,
                'discount_pct' => $line->discountPct,
                'tax_code_id' => $line->taxCodeId,
                'line_total_fc' => $line->lineTotalFc,
                'tax_amount_fc' => $line->taxAmountFc,
                'tax_detail' => json_encode((object) $line->taxDetail, JSON_THROW_ON_ERROR),
                'reverse_charge_fc' => $line->reverseChargeFc,
                'purchase_order_line_id' => $line->purchaseOrderLineId,
                'goods_receipt_line_id' => $line->goodsReceiptLineId,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            for ($p = 1; $p <= 8; $p++) {
                $row["dim{$p}_value_id"] = $line->dims[$p] ?? null;
            }
            $rows[] = $row;
        }
        $this->db->connection()->table('invoice_lines')->insert($rows);
    }
}
