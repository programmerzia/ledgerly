<?php

declare(strict_types=1);

namespace App\Actions\Transfers;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Transfers\Inputs\FundTransferDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Services\Transfers\FundTransferService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Creates (no id) or replaces (id and the version the client saw) a draft fund transfer. People only: `transfers.create`. */
final class SaveFundTransferDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly FundTransferService $service,
    ) {}

    public function handle(Actor $actor, FundTransferDraftInput $in, ?string $transferId = null, ?int $lockVersion = null): FundTransfer
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in, $transferId, $lockVersion) {
            $this->guard->require($actor, 'transfers.create', $in->companyId);
            $company = Company::query()->findOrFail($in->companyId);
            $header = $this->service->header($in, $company);

            if ($transferId === null) {
                $t = new FundTransfer;
                $t->forceFill([
                    'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                    'status' => DocumentStatus::Draft, 'leg_state' => 'not_sent', ...$header, 'created_by' => $actor->id, 'lock_version' => 0,
                ])->save();
                $audit->add('fund_transfer.created', $t, after: $t);

                return $t;
            }

            $t = $locks->document(FundTransfer::query()->where('company_id', $in->companyId)->findOrFail($transferId), $lockVersion);
            if ($t->status !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited; a transfer that was returned is a draft again.');
            }
            $before = $t->attributesToArray();
            $t->forceFill([...$header, 'lock_version' => $t->lock_version + 1])->save();
            $audit->add('fund_transfer.updated', $t, before: $before, after: $t);

            return $t;
        });
    }
}
