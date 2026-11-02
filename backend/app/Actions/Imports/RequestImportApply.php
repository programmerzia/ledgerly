<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use App\Support\Actor;
use App\Support\Imports\ImportQueue;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Asks for the previewed import to be applied on the queue. This is where the person is checked, because the queue has no session:
 * their permission for the kind, and for opening balances (which post to the ledger) a signing grant, whose signer and time are recorded
 * on the import. Idempotent: an import already queued, applying or finished is returned as it is and queued no more; the import row is
 * locked, so two simultaneous requests produce exactly one job.
 */
final class RequestImportApply
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock, private readonly ImportKinds $kinds, private readonly ImportGuard $guard) {}

    public function handle(Actor $actor, string $importId): Import
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $importId): Import {
            $import = Import::query()->lockForUpdate()->findOrFail($importId);
            $kind = $this->kinds->get($import->kind);
            $this->guard->require($actor, $kind, $import->company_id);

            if (in_array($import->status, ['queued', 'applying', 'completed', 'failed'], true)) {
                return $import; // already requested: nothing more to do
            }
            $this->guard->requireOpen($import);
            if ($import->status !== 'previewed') {
                throw DomainRuleViolation::single('import_state_invalid', 'Preview the import before applying it.');
            }
            if ($import->rows_valid === 0) {
                throw DomainRuleViolation::single('import_nothing_to_apply', 'No row is valid, so there is nothing to apply.');
            }
            if ($kind->atomic() && ($import->rows_invalid > 0 || $import->errors !== null)) {
                throw DomainRuleViolation::single('import_has_errors', 'This import applies all rows or none; fix every error in the preview first.');
            }
            if ($kind->needsSignature()) {
                if (! $actor->hasSigningGrant) {
                    throw DomainRuleViolation::single('signature_required', 'Importing opening balances needs your signing PIN.');
                }
                $clash = Import::query()->where('company_id', $import->company_id)->where('kind', $import->kind)->where('id', '!=', $import->id)->whereIn('status', ['queued', 'applying'])->exists();
                if ($clash) {
                    throw DomainRuleViolation::single('opening_import_in_progress', 'Another opening balances import is waiting to be applied.');
                }
            }

            $now = $this->clock->now();
            $before = ['status' => $import->status];
            $import->forceFill([
                'status' => 'queued', 'requested_by' => $actor->id, 'queued_at' => $now, 'lock_version' => $import->lock_version + 1,
                ...($kind->needsSignature() ? ['signed_by' => $actor->id, 'signed_at' => $now] : []),
            ])->save();
            $import->refresh();
            $audit->add('import.apply_requested', $import, before: $before, after: ['status' => 'queued'], context: [
                'kind' => $import->kind, 'rows' => $import->rows_valid, 'signed_by' => $kind->needsSignature() ? $actor->id : null,
            ]);
            $this->uow->afterCommit(fn () => ImportQueue::push($actor->tenantId, $import->company_id, $import->id));

            return $import;
        });
    }
}
