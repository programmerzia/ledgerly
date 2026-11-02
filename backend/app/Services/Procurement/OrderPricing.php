<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Trade\InvoiceKind;
use App\Services\Trade\ComputedDocument;
use App\Services\Trade\DocumentCalculator;

/**
 * Prices an order with the calculator bills use, so an order line and the bill line made from it agree on net, tax and
 * base amounts. Withholding is left out: it arises when the supplier is paid, on the bill.
 */
final class OrderPricing
{
    public function __construct(private readonly DocumentCalculator $calculator) {}

    public function compute(OrderDraftInput $in): ComputedDocument
    {
        return $this->calculator->compute(new InvoiceDraftInput(
            companyId: $in->companyId,
            kind: InvoiceKind::PurchaseBill,
            contactId: $in->contactId,
            issueDate: $in->orderDate,
            lines: array_map(fn (OrderLineInput $l) => new InvoiceLineInput(
                quantity: $l->quantity, itemId: $l->itemId, accountId: $l->accountId, description: $l->description, unitPriceFc: $l->unitPriceFc,
                taxCodeId: $l->taxCodeId, taxCodeGiven: $l->taxCodeGiven, dims: $l->dims,
            ), $in->lines),
            dueDate: $in->orderDate,
            currency: $in->currency,
            fxRate: $in->fxRate,
            whtCodeGiven: true,
        ));
    }
}
