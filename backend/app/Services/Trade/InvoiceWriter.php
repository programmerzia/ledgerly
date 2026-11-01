<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
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
