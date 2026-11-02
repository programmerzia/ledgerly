<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Domain\Procurement\MatchLine;
use App\Domain\Procurement\ThreeWayMatch;
use App\Domain\Shared\Violation;
use App\Domain\Trade\InvoiceKind;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Trade\Invoice;
use App\Queries\Procurement\OrderLineFigures;
use App\Queries\Procurement\ProcurementSettings;

/** Sets a bill's lines against their order lines. Reads only; the caller decides what to do and holds the locks if it must. */
final class BillMatchEvaluator
{
    public function __construct(private readonly OrderLineFigures $figures) {}

    public function evaluate(Invoice $bill): BillMatchEvaluation
    {
        if ($bill->kind !== InvoiceKind::PurchaseBill) {
            return new BillMatchEvaluation(false);
        }
        $settings = ProcurementSettings::of($bill->company_id);
        $linked = $bill->lines->filter(fn ($l) => $l->purchase_order_line_id !== null);
        if ($linked->isEmpty() && ! $settings->requirePurchaseOrder) {
            return new BillMatchEvaluation(false);
        }

        $mismatches = [];
        if ($settings->requirePurchaseOrder) {
            foreach ($bill->lines->filter(fn ($l) => $l->purchase_order_line_id === null) as $line) {
                $mismatches[] = new Violation('purchase_order_required', "Line {$line->line_no} has no purchase order, and this company requires one.", $line->line_no);
            }
        }

        $orderLines = PurchaseOrderLine::query()->with('order')->whereIn('id', $linked->pluck('purchase_order_line_id')->all())->get()->keyBy('id');
        $figures = $this->figures->forOrders(array_values(array_unique($orderLines->pluck('purchase_order_id')->all())), $bill->id);

        $refusals = [];
        $match = [];
        $rows = [];
        foreach ($linked as $line) {
            $orderLine = $orderLines->get($line->purchase_order_line_id);
            if ($orderLine === null) {
                continue; // the foreign key makes this impossible
            }
            $order = $orderLine->order;
            $label = $order->number ?? 'the order';
            if ($order->contact_id !== $bill->contact_id) {
                $refusals[] = new Violation('bill_order_supplier_mismatch', "Line {$line->line_no}: {$label} is with a different supplier.", $line->line_no);
            }
            if ($order->currency !== $bill->currency) {
                $refusals[] = new Violation('bill_order_currency_mismatch', "Line {$line->line_no}: {$label} is in {$order->currency}, not {$bill->currency}.", $line->line_no);
            }
            if (! $order->status->isOpen()) {
                $refusals[] = new Violation('bill_order_not_open', "Line {$line->line_no}: {$label} is {$order->status->value} and takes no more bills.", $line->line_no);
            }
            $f = $figures[$orderLine->id];
            $match[] = new MatchLine($line->line_no, $orderLine->id, $label, (string) $line->quantity, $line->unit_price_fc, (string) $line->discount_pct, $orderLine->unit_price_fc, $f->received, $f->billed);
            $rows[] = [
                'line_no' => $line->line_no, 'order_line_id' => $orderLine->id, 'purchase_order_id' => $order->id, 'order_number' => $order->number,
                'order_price_fc' => $orderLine->unit_price_fc, 'ordered' => $f->ordered, 'received' => $f->received, 'billed_elsewhere' => $f->billed,
            ];
        }

        return new BillMatchEvaluation(
            true, $refusals,
            [...$mismatches, ...ThreeWayMatch::check($match, $settings->priceTolerancePct, $settings->quantityTolerancePct)],
            $rows,
        );
    }
}
