<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Contracts\Clock;
use App\Events\Imports\ImportApplied;
use App\Events\Imports\ImportFailed;
use App\Models\Imports\Import;
use App\Models\Imports\ImportRow;
use App\Models\Organisation\Company;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\ImportRunner;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The queued half of an import (run by `ApplyImportJob`, inside the tenant). Acts as the person who requested the apply, with the
 * signing grant recorded then. Claims the import (queued → applying), applies the valid rows unit by unit through the target Actions,
 * and finishes it. Running it again is harmless: a finished import is left alone and a row already applied is never applied twice
 * (`unit` skips rows that are no longer valid). `retry` lets a job's second attempt take over an import its first attempt left
 * `applying`; without it an `applying` import belongs to the worker that claimed it.
 */
final class ApplyImport
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
        private readonly ImportKinds $kinds,
    ) {}

    public function handle(string $tenantId, string $companyId, string $importId, bool $retry = false): ?Import
    {
        $import = $this->claim($tenantId, $companyId, $importId, $retry);
        if ($import === null) {
            return null;
        }

        $actor = new Actor(
            ActorType::User, $import->requested_by, $tenantId, $companyId,
            hasSigningGrant: $import->signed_by !== null && $import->signed_by === $import->requested_by, requestId: 'import:'.$import->id,
        );
        $kind = $this->kinds->get($import->kind);
        $ctx = new ImportContext(Company::query()->findOrFail($companyId), $import, $actor);
        $runner = new ImportRunner($import, $actor, $this->uow, $this->clock);

        $kind->apply($ctx, $actor, $runner);

        return $this->finish($actor, $import, $runner, $kind->atomic());
    }

    private function claim(string $tenantId, string $companyId, string $importId, bool $retry): ?Import
    {
        $actor = Actor::system($tenantId, $companyId);

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($companyId, $importId, $retry): ?Import {
            $import = Import::query()->where('company_id', $companyId)->lockForUpdate()->find($importId);
            if ($import === null || $import->requested_by === null) {
                return null;
            }
            if ($import->status === 'queued' || ($import->status === 'applying' && $retry)) {
                $import->forceFill(['status' => 'applying', 'started_at' => $import->started_at ?? $this->clock->now(), 'lock_version' => $import->lock_version + 1])->save();

                return $import;
            }

            return null; // finished, or being applied by another worker
        });
    }

    private function finish(Actor $actor, Import $import, ImportRunner $runner, bool $atomic): Import
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($import, $runner, $atomic): Import {
            $import = Import::query()->lockForUpdate()->findOrFail($import->id);
            $counts = $runner->counts();

            $first = ImportRow::query()->where('import_id', $import->id)->where('status', 'applied')->orderBy('row_number')->first();
            $failedFirst = ImportRow::query()->where('import_id', $import->id)->where('status', 'failed')->orderBy('row_number')->first();
            $failed = $atomic && $counts['rows_failed'] > 0;
            $result = [...($import->result ?? []), 'applied' => [
                'rows_applied' => $counts['rows_applied'], 'rows_failed' => $counts['rows_failed'],
                ...($first->result ?? []),
            ]];
            $import->forceFill([
                ...$counts, 'status' => $failed ? 'failed' : 'completed', 'finished_at' => $this->clock->now(), 'result' => $result,
                'errors' => $failed ? ($failedFirst->errors ?? [['code' => 'import_failed', 'message' => 'The import could not be applied.']]) : $import->errors,
                'lock_version' => $import->lock_version + 1,
            ])->save();
            $import->refresh();

            $data = ['kind' => $import->kind, 'rows_applied' => $import->rows_applied, 'rows_failed' => $import->rows_failed];
            $audit->add($failed ? 'import.failed' : 'import.applied', $import, context: [...$data, 'requested_by' => $import->requested_by, 'signed_by' => $import->signed_by]);
            $outbox->add($failed ? new ImportFailed($import->id, $import->company_id, $import->lock_version, $data) : new ImportApplied($import->id, $import->company_id, $import->lock_version, $data));

            return $import;
        });
    }
}
