<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\PaymentRunDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\PaymentRun;
use App\Services\Trade\PaymentRunWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Saves a payment run as a draft (people only: `payments.create`; tokens may read runs but never write them). */
final class CreatePaymentRunDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly PaymentRunWriter $writer,
    ) {}

    public function handle(Actor $actor, PaymentRunDraftInput $in): PaymentRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'payments.create', $in->companyId);
            $company = Company::query()->findOrFail($in->companyId);
            [$header, $rows] = $this->writer->build($actor, $in, $company);

            $run = new PaymentRun;
            $run->forceFill([
                'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                'status' => DocumentStatus::Draft, ...$header, 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            $this->writer->writeItems($run, $rows);

            $audit->add('payment_run.created', $run, after: $run, context: ['items' => count($rows)]);

            return $run;
        });
    }
}
