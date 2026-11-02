<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Models\Procurement\PurchaseOrder;
use App\Services\Trade\ComputedDocument;
use App\Services\Trade\ComputedLine;
use App\Support\Actor;
use Illuminate\Database\DatabaseManager;

/** Writes a priced order: its header columns and its lines. */
final class OrderWriter
{
    public function __construct(
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    /** @return array<string, mixed> the columns a price change moves */
    public function totals(ComputedDocument $c): array
    {
        return [
            'subtotal_fc' => $c->subtotalFc, 'tax_total_fc' => $c->taxTotalFc, 'total_fc' => $c->totalFc,
            'subtotal' => $c->subtotal, 'tax_total' => $c->taxTotal, 'total' => $c->total,
        ];
    }

    /** @return array<string, mixed> */
    public function header(OrderDraftInput $in, ComputedDocument $c): array
    {
        return [
            'contact_id' => $in->contactId,
            'order_date' => $in->orderDate,
            'expected_date' => $in->expectedDate,
            'currency' => $c->currency,
            'fx_rate' => $c->fxRate,
            'reference' => $in->reference,
            'memo' => $in->memo,
            ...$this->totals($c),
        ];
    }

    /** The columns of one priced line, without its identity.
     * @return array<string, mixed>
     */
    public function lineColumns(ComputedLine $line): array
    {
        $row = [
            'item_id' => $line->itemId,
            'account_id' => $line->accountId,
            'description' => $line->description,
            'quantity' => $line->quantity,
            'unit_price_fc' => $line->unitPriceFc,
            'tax_code_id' => $line->taxCodeId,
            'line_total_fc' => $line->lineTotalFc,
            'tax_amount_fc' => $line->taxAmountFc,
            'tax_detail' => json_encode((object) $line->taxDetail, JSON_THROW_ON_ERROR),
        ];
        for ($p = 1; $p <= 8; $p++) {
            $row["dim{$p}_value_id"] = $line->dims[$p] ?? null;
        }

        return $row;
    }

    /** @param list<OrderLineInput> $inputs same order as $c->lines */
    public function insertLines(Actor $actor, PurchaseOrder $order, array $inputs, ComputedDocument $c): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $rows = [];
        foreach ($c->lines as $i => $line) {
            $rows[] = [
                'id' => $inputs[$i]->id ?? $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'company_id' => $order->company_id,
                'purchase_order_id' => $order->id,
                'line_no' => $i + 1,
                'requisition_line_id' => $inputs[$i]->requisitionLineId,
                ...$this->lineColumns($line),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        $this->db->connection()->table('purchase_order_lines')->insert($rows);
    }
}
