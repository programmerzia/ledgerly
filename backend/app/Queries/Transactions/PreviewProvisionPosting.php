<?php

declare(strict_types=1);

namespace App\Queries\Transactions;

use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Models\Transactions\ProvisionRun;
use App\Queries\Trade\InvoicePostingPreview;
use App\Services\Ledger\PostingEngine;
use App\Services\Transactions\ProvisionService;
use App\Support\Actor;
use DateTimeImmutable;

/** The journal a provisioning run would post and the validator's verdict; also refuses a run whose figures went stale. */
final class PreviewProvisionPosting
{
    public function __construct(
        private readonly PostingEngine $engine,
        private readonly PostingValidator $validator,
        private readonly ProvisionService $service,
    ) {}

    public function of(Actor $actor, string $runId): InvoicePostingPreview
    {
        $run = ProvisionRun::query()->findOrFail($runId);
        $violations = [];
        if (! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            $violations[] = new Violation('document_not_postable', "A {$run->status->value} provision run cannot be posted.");
        }
        $period = FiscalPeriod::query()->find($run->fiscal_period_id);
        $lines = [];
        $debit = $credit = 0;
        try {
            $company = Company::query()->findOrFail($run->company_id);
            $now = $this->service->compute($company, DateTimeImmutable::createFromInterface($run->as_of));
            if ($now['required'] !== $run->required || $now['existing'] !== $run->existing) {
                $violations[] = new Violation('provision_run_stale', 'The receivables or the allowance changed after this run was prepared. Void it and prepare a new one.');
            }
            $draft = $this->service->draft($run, $company, $run->number ?? 'Draft');
            $lines = $draft->lines;
            if ($period !== null) {
                try {
                    $plan = $this->validator->validate($draft, $this->engine->context($actor, $draft, $period));
                    $debit = $plan->totalDebit;
                    $credit = $plan->totalCredit;
                } catch (PostingRejected $e) {
                    array_push($violations, ...$e->violations);
                }
            }
        } catch (DomainRuleViolation $e) {
            array_push($violations, ...($e->violations !== [] ? $e->violations : [new Violation($e->errorCode, $e->getMessage())]));
        }

        return new InvoicePostingPreview($violations === [], $violations, $period?->id, $period?->name, $period?->status->value, $debit, $credit, $lines);
    }
}
