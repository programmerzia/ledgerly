<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\PaymentRunDraftInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\PaymentRun;
use App\Services\Trade\PaymentRunWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft payment run with the version the client saw. */
final class UpdatePaymentRunDraft
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly PaymentRunWriter $writer) {}

    public function handle(Actor $actor, string $runId, int $lockVersion, PaymentRunDraftInput $in): PaymentRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $runId, $lockVersion, $in) {
            $seen = PaymentRun::query()->findOrFail($runId);
            $this->guard->require($actor, 'payments.create', $seen->company_id);

            $run = $locks->document($seen, $lockVersion);
            if ($run->status !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited; a run that was returned is a draft again.');
            }
            $company = Company::query()->findOrFail($run->company_id);
            [$header, $rows] = $this->writer->build($actor, $in, $company);

            $before = $run->attributesToArray();
            $run->forceFill([...$header, 'lock_version' => $run->lock_version + 1])->save();
            $this->writer->writeItems($run, $rows);
            $audit->add('payment_run.updated', $run, before: $before, after: $run, context: ['items' => count($rows)]);

            return $run;
        });
    }
}
