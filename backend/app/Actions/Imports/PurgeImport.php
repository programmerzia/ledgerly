<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\ImportRows;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Clears the cell text of an import's rows (retention): what the uploader typed is personal and financial data, and the file is not
 * kept either. The rows themselves stay with their number, status, errors and what they created, so the history of the import is still
 * readable. A purged import cannot be previewed or applied again. Not allowed while the import is waiting to apply or applying.
 */
final class PurgeImport
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock, private readonly ImportKinds $kinds, private readonly ImportGuard $guard, private readonly ImportRows $rows) {}

    public function handle(Actor $actor, string $importId): Import
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $importId): Import {
            $import = $locks->document(Import::query()->findOrFail($importId));
            $this->guard->require($actor, $this->kinds->get($import->kind), $import->company_id);
            if (in_array($import->status, ['queued', 'applying'], true)) {
                throw DomainRuleViolation::single('import_state_invalid', 'The import is waiting to be applied or being applied; purge it afterwards.');
            }
            if ($import->rows_purged_at !== null) {
                return $import;
            }

            $this->rows->purgeCells($import->id);
            $import->forceFill(['rows_purged_at' => $this->clock->now(), 'lock_version' => $import->lock_version + 1])->save();
            $import->refresh();
            $audit->add('import.purged', $import, context: ['rows' => $import->rows_total]);

            return $import;
        });
    }
}
