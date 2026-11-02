<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\ConvertRequisitionInput;
use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Domain\Procurement\RequisitionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Trade\Contact;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Turns approved requisition lines into a draft order for one supplier. A line goes whole, to one live order; cancelling the
 * order, or dropping the line from it, frees it again. The requisition is locked first (rank below orders), so two people
 * cannot convert the same line. The estimate is in base currency, so an order in another currency must state its prices.
 */
final class ConvertRequisition
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly CreatePurchaseOrderDraft $create,
    ) {}

    public function handle(Actor $actor, ConvertRequisitionInput $in): PurchaseOrder
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = PurchaseRequisition::query()->findOrFail($in->requisitionId);
            $this->guard->require($actor, 'purchase_orders.create', $seen->company_id, tokens: true);
            $requisition = $locks->document($seen)->load('lines');
            if ($requisition->status !== RequisitionStatus::Approved) {
                throw DomainRuleViolation::single('requisition_not_approved', 'Only an approved requisition can become an order.');
            }

            $wanted = array_map(fn ($l) => $l->requisitionLineId, $in->lines);
            if (count($wanted) !== count(array_unique($wanted))) {
                throw DomainRuleViolation::single('requisition_line_invalid', 'A requisition line can go on an order once.');
            }
            $taken = PurchaseOrderLine::query()->whereIn('requisition_line_id', $wanted)
                ->whereHas('order', fn ($q) => $q->where('status', '<>', 'cancelled'))->exists();
            if ($taken) {
                throw DomainRuleViolation::single('requisition_line_converted', 'One of these lines is already on an order.');
            }

            $currency = $in->currency ?? Contact::query()->whereKey($in->contactId)->value('default_currency');
            $lines = [];
            foreach ($in->lines as $chosen) {
                $line = $requisition->lines->firstWhere('id', $chosen->requisitionLineId)
                    ?? throw DomainRuleViolation::single('requisition_line_invalid', 'A line is not on this requisition.');
                $price = $chosen->unitPriceFc ?? ($currency === $requisition->currency ? $line->estimated_unit_price : null)
                    ?? throw DomainRuleViolation::single('line_price_missing', "Line {$line->line_no}: the estimate is in {$requisition->currency}, so state the price in {$currency}.");
                $dims = [];
                for ($p = 1; $p <= 8; $p++) {
                    $value = $line->dimensionValue($p);
                    if ($value !== null) {
                        $dims[$p] = $value;
                    }
                }
                $lines[] = new OrderLineInput(
                    quantity: (string) $line->quantity, itemId: $line->item_id, accountId: $line->account_id, description: $line->description,
                    unitPriceFc: $price, taxCodeId: $chosen->taxCodeId, taxCodeGiven: $chosen->taxCodeGiven, dims: $dims, requisitionLineId: $line->id,
                );
            }

            $order = $this->create->handle($actor, new OrderDraftInput(
                companyId: $requisition->company_id, contactId: $in->contactId, orderDate: $in->orderDate, lines: $lines,
                expectedDate: $in->expectedDate, currency: $in->currency, fxRate: $in->fxRate, reference: $in->reference, memo: $in->memo,
            ));
            $audit->add('purchase_requisition.converted', $requisition, context: ['purchase_order_id' => $order->id, 'lines' => $wanted]);

            return $order;
        });
    }
}
