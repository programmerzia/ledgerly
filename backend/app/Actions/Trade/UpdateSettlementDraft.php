<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\UpdateSettlementDraftInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\Settlement;
use App\Services\Trade\SettlementWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft settlement (header and allocations) with the version the client saw (13 §11). */
final class UpdateSettlementDraft
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly SettlementWriter $writer) {}

    public function handle(Actor $actor, UpdateSettlementDraftInput $in): Settlement
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = Settlement::query()->findOrFail($in->settlementId);
            $this->guard->require($actor, SettlementWriter::module($seen->kind).'.create', $seen->company_id, tokens: true);

            $s = $locks->document($seen, $in->lockVersion);
            if ($s->status !== DocumentStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited; a settlement that was returned is a draft again.');
            }
            $draft = $in->draft;
            if ($draft->kind !== $s->kind || $draft->companyId !== $s->company_id) {
                throw DomainRuleViolation::single('document_kind_fixed', 'The kind of a settlement cannot change.');
            }
            $company = Company::query()->findOrFail($s->company_id);

            $before = $s->attributesToArray();
            $s->forceFill([...$this->writer->header($draft, $company), 'lock_version' => $s->lock_version + 1])->save();
            $this->writer->writeAllocations($actor, $s, $draft);
            if ($s->payment_run_id === null) {
                $this->writer->validate($s, $company);
            }

            $audit->add('settlement.updated', $s, before: $before, after: $s, context: ['allocations' => count($draft->allocations)]);

            return $s;
        });
    }
}
