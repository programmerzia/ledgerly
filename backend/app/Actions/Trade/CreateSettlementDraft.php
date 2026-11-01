<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\Settlement;
use App\Services\Trade\SettlementWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Saves a receipt, payment or refund as a draft. The server fixes the rate and the base amount; allocations are
 * checked now so a draft that can never post is refused early, and checked again under the locks when it posts.
 */
final class CreateSettlementDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly SettlementWriter $writer,
    ) {}

    public function handle(Actor $actor, SettlementDraftInput $in): Settlement
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, SettlementWriter::module($in->kind).'.create', $in->companyId, tokens: true);
            $company = Company::query()->findOrFail($in->companyId);

            $s = new Settlement;
            $s->forceFill([
                'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'kind' => $in->kind,
                'status' => DocumentStatus::Draft, ...$this->writer->header($in, $company),
                'payment_run_id' => $in->paymentRunId, 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            $this->writer->writeAllocations($actor, $s, $in);
            if ($in->paymentRunId === null) {
                $this->writer->validate($s, $company);
            }

            $audit->add('settlement.created', $s, after: $s, context: ['kind' => $in->kind, 'allocations' => count($in->allocations)]);

            return $s;
        });
    }
}
