<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Trade\Invoice;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\TradePosting;
use App\Support\Actor;

/**
 * Builds the journal a document would post and runs the posting validator over it, without locks or side
 * effects: the same rules and codes as `PostInvoice` (13 §9). Used by the preview endpoint and by SubmitDocument
 * to fail early. The number is never predicted; it is allocated gaplessly only when the posting commits.
 */
final class PreviewInvoicePosting
{
    public function __construct(
        private readonly PostingEngine $engine,
        private readonly PostingValidator $validator,
        private readonly TradePosting $trade,
    ) {}

    public function of(Actor $actor, string $invoiceId): InvoicePostingPreview
    {
        $doc = Invoice::query()->with('lines')->findOrFail($invoiceId);
        $period = FiscalPeriod::query()->where('company_id', $doc->company_id)->where('kind', 'regular')
            ->where('starts_on', '<=', $doc->issue_date->format('Y-m-d'))->where('ends_on', '>=', $doc->issue_date->format('Y-m-d'))->first();

        $violations = [];
        $lines = [];
        $totals = [0, 0];

        if (! in_array($doc->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            $violations[] = new Violation('document_not_postable', "A {$doc->status->value} {$doc->kind->label()} cannot be posted.");
        }
        try {
            $draft = $this->trade->draft($doc, $doc->number);
            $lines = $draft->lines;
            if ($period === null) {
                $violations[] = new Violation('period_missing', 'No fiscal period covers the issue date.');
            } else {
                $ctx = $this->engine->context($actor, $draft, $period);
                try {
                    $plan = $this->validator->validate($draft, $ctx);
                    $totals = [$plan->totalDebit, $plan->totalCredit];
                } catch (PostingRejected $e) {
                    array_push($violations, ...$e->violations);
                    $totals = [(int) array_sum(array_map(fn ($l) => $l->debit, $lines)), (int) array_sum(array_map(fn ($l) => $l->credit, $lines))];
                }
            }
        } catch (DomainRuleViolation $e) {
            array_push($violations, ...($e->violations !== [] ? $e->violations : [new Violation($e->errorCode, $e->getMessage())]));
        }

        return new InvoicePostingPreview($violations === [], $violations, $period?->id, $period?->name, $period?->status->value, $totals[0], $totals[1], $lines);
    }
}
