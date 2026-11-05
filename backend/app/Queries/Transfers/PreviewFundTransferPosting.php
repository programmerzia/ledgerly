<?php

declare(strict_types=1);

namespace App\Queries\Transfers;

use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Queries\Trade\InvoicePostingPreview;
use App\Services\Ledger\PostingEngine;
use App\Services\Transfers\FundTransferService;
use App\Support\Actor;

/** The journal(s) a transfer would post at approval (the send leg, plus the receive leg for a same-day transfer) and the validator's verdict. */
final class PreviewFundTransferPosting
{
    public function __construct(
        private readonly PostingEngine $engine,
        private readonly PostingValidator $validator,
        private readonly FundTransferService $service,
    ) {}

    public function of(Actor $actor, string $transferId): InvoicePostingPreview
    {
        $t = FundTransfer::query()->findOrFail($transferId);
        $violations = [];
        if (! in_array($t->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            $violations[] = new Violation('document_not_postable', "A {$t->status->value} transfer cannot be posted.");
        }
        $day = $t->send_date->format('Y-m-d');
        $period = FiscalPeriod::query()->where('company_id', $t->company_id)->where('kind', 'regular')
            ->where('starts_on', '<=', $day)->where('ends_on', '>=', $day)->first();
        if ($period === null) {
            $violations[] = new Violation('period_missing', 'No fiscal period covers the date.');
        }
        $lines = [];
        $debit = $credit = 0;
        try {
            $company = Company::query()->findOrFail($t->company_id);
            $figures = $this->service->figures($t, $company);
            $drafts = [$this->service->sendDraft($figures, $t->company_id, $company->base_currency)];
            if ($t->settle_same_day) {
                $drafts[] = $this->service->receiveDraft($figures, $t->company_id, $company->base_currency, $day);
            }
            foreach ($drafts as $draft) {
                array_push($lines, ...$draft->lines);
                if ($period === null) {
                    continue;
                }
                try {
                    $plan = $this->validator->validate($draft, $this->engine->context($actor, $draft, $period));
                    $debit += $plan->totalDebit;
                    $credit += $plan->totalCredit;
                } catch (PostingRejected $e) {
                    array_push($violations, ...$e->violations);
                    $debit += (int) array_sum(array_map(fn (DraftLine $l): int => $l->debit, $draft->lines));
                    $credit += (int) array_sum(array_map(fn (DraftLine $l): int => $l->credit, $draft->lines));
                }
            }
        } catch (DomainRuleViolation $e) {
            array_push($violations, ...($e->violations !== [] ? $e->violations : [new Violation($e->errorCode, $e->getMessage())]));
        }

        return new InvoicePostingPreview($violations === [], $violations, $period?->id, $period?->name, $period?->status->value, $debit, $credit, $lines);
    }
}
