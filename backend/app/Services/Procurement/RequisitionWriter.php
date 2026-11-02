<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Actions\Procurement\Inputs\RequisitionDraftInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\LineAmount;
use App\Models\Organisation\Company;
use App\Models\Procurement\PurchaseRequisition;
use App\Support\Actor;
use Illuminate\Database\DatabaseManager;

/** Checks a requisition draft, totals it (in the company's base currency) and writes its lines. */
final class RequisitionWriter
{
    public function __construct(
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    /** @return array{currency: string, total: int, line_totals: list<int>} */
    public function compute(RequisitionDraftInput $in): array
    {
        if ($in->lines === []) {
            throw DomainRuleViolation::single('document_lines_missing', 'Add at least one line.');
        }
        $totals = [];
        foreach ($in->lines as $i => $line) {
            if (($line->itemId === null || $line->itemId === '') && trim((string) $line->description) === '') {
                throw DomainRuleViolation::single('requisition_line_empty', 'Line '.($i + 1).' needs an item or a description.');
            }
            $totals[] = LineAmount::net($line->quantity, $line->estimatedUnitPrice);
        }

        return ['currency' => Company::query()->findOrFail($in->companyId)->base_currency, 'total' => array_sum($totals), 'line_totals' => $totals];
    }

    /**
     * @param  array{currency: string, total: int, line_totals: list<int>}  $computed
     * @return array<string, mixed>
     */
    public function header(RequisitionDraftInput $in, array $computed): array
    {
        return ['requisition_date' => $in->requisitionDate, 'memo' => $in->memo, 'currency' => $computed['currency'], 'total' => $computed['total']];
    }

    /** @param  array{currency: string, total: int, line_totals: list<int>}  $computed */
    public function insertLines(Actor $actor, PurchaseRequisition $requisition, RequisitionDraftInput $in, array $computed): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $rows = [];
        foreach ($in->lines as $i => $line) {
            $row = [
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $requisition->company_id,
                'purchase_requisition_id' => $requisition->id, 'line_no' => $i + 1,
                'item_id' => $line->itemId, 'description' => $line->description, 'quantity' => $line->quantity,
                'estimated_unit_price' => $line->estimatedUnitPrice, 'line_total' => $computed['line_totals'][$i],
                'account_id' => $line->accountId, 'needed_by' => $line->neededBy?->format('Y-m-d'),
                'created_at' => $now, 'updated_at' => $now,
            ];
            for ($p = 1; $p <= 8; $p++) {
                $row["dim{$p}_value_id"] = $line->dims[$p] ?? null;
            }
            $rows[] = $row;
        }
        $this->db->connection()->table('purchase_requisition_lines')->insert($rows);
    }
}
