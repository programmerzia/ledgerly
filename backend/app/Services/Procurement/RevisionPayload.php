<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Actions\Procurement\Inputs\RevisionInput;
use App\Domain\Procurement\RevisionLine;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Services\Trade\ComputedDocument;
use DateTimeImmutable;

/** A revision's proposal: stored as JSON, priced by the same code as the order, on the order's fixed header. */
final class RevisionPayload
{
    public function __construct(private readonly OrderPricing $pricing) {}

    public function price(PurchaseOrder $order, RevisionInput $in): ComputedDocument
    {
        return $this->pricing->compute($this->draft($order, $in));
    }

    public function draft(PurchaseOrder $order, RevisionInput $in): OrderDraftInput
    {
        return new OrderDraftInput(
            companyId: $order->company_id,
            contactId: $order->contact_id,
            orderDate: new DateTimeImmutable($order->order_date->format('Y-m-d')),
            lines: $in->lines,
            expectedDate: $in->expectedDate,
            currency: $order->currency,
            fxRate: (string) $order->fx_rate,
            reference: $in->reference,
            memo: $in->memo,
        );
    }

    /** @return array<string, mixed> everything the server resolved, so what was approved is what gets applied */
    public function toProposed(RevisionInput $in, ComputedDocument $c): array
    {
        $lines = [];
        foreach ($c->lines as $i => $line) {
            $lines[] = [
                'id' => $in->lines[$i]->id, 'item_id' => $line->itemId, 'account_id' => $line->accountId, 'description' => $line->description,
                'quantity' => $line->quantity, 'unit_price_fc' => $line->unitPriceFc, 'tax_code_id' => $line->taxCodeId,
                'line_total_fc' => $line->lineTotalFc, 'tax_amount_fc' => $line->taxAmountFc,
                'dims' => $line->dims === [] ? (object) [] : $line->dims,
            ];
        }

        return [
            'expected_date' => $in->expectedDate?->format('Y-m-d'), 'reference' => $in->reference, 'memo' => $in->memo, 'lines' => $lines,
            'subtotal_fc' => $c->subtotalFc, 'tax_total_fc' => $c->taxTotalFc, 'total_fc' => $c->totalFc,
        ];
    }

    public function fromProposed(PurchaseOrderRevision $revision): RevisionInput
    {
        $p = $revision->proposed;
        $lines = [];
        foreach ((array) ($p['lines'] ?? []) as $line) {
            $line = (array) $line;
            $dims = [];
            foreach ((array) ($line['dims'] ?? []) as $slot => $value) {
                $dims[(int) $slot] = (string) $value;
            }
            $lines[] = new OrderLineInput(
                quantity: (string) $line['quantity'],
                id: isset($line['id']) ? (string) $line['id'] : null,
                itemId: isset($line['item_id']) ? (string) $line['item_id'] : null,
                accountId: (string) $line['account_id'],
                description: isset($line['description']) ? (string) $line['description'] : null,
                unitPriceFc: (int) $line['unit_price_fc'],
                taxCodeId: isset($line['tax_code_id']) ? (string) $line['tax_code_id'] : null,
                taxCodeGiven: true,
                dims: $dims,
            );
        }

        return new RevisionInput(
            $revision->reason, $lines,
            isset($p['expected_date']) ? new DateTimeImmutable((string) $p['expected_date']) : null,
            isset($p['reference']) ? (string) $p['reference'] : null,
            isset($p['memo']) ? (string) $p['memo'] : null,
        );
    }

    /**
     * @param  list<OrderLineInput>  $lines
     * @return list<RevisionLine>
     */
    public function ruleLines(array $lines): array
    {
        $out = [];
        foreach ($lines as $i => $line) {
            $out[] = new RevisionLine($i + 1, $line->id, $line->itemId, $line->quantity);
        }

        return $out;
    }
}
