<?php

declare(strict_types=1);

namespace App\Actions\Transactions;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Transactions\Inputs\WriteOffDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Transactions\WriteOff;
use App\Services\Transactions\WriteOffService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Creates (no id) or replaces (id and version) a draft write-off. People only: `write_offs.create`. */
final class SaveWriteOffDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly WriteOffService $service,
    ) {}

    public function handle(Actor $actor, WriteOffDraftInput $in, ?string $writeOffId = null, ?int $lockVersion = null): WriteOff
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in, $writeOffId, $lockVersion) {
            $this->guard->require($actor, 'write_offs.create', $in->companyId);
            $header = $this->service->header($in, Company::query()->findOrFail($in->companyId));

            if ($writeOffId === null) {
                $w = new WriteOff;
                $w->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'status' => DocumentStatus::Draft,
                    ...$header, 'created_by' => $actor->id, 'lock_version' => 0,
                ])->save();
                $audit->add('write_off.created', $w, after: $w);

                return $w;
            }
            $w = $locks->document(WriteOff::query()->where('company_id', $in->companyId)->findOrFail($writeOffId), $lockVersion);
            if ($w->status !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited.');
            }
            $before = $w->attributesToArray();
            $w->forceFill([...$header, 'lock_version' => $w->lock_version + 1])->save();
            $audit->add('write_off.updated', $w, before: $before, after: $w);

            return $w;
        });
    }
}
