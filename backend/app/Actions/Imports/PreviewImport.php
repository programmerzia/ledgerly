<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Imports\Import;
use App\Models\Imports\ImportRow;
use App\Models\Organisation\Company;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\ImportRows;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Checks every row with the rules of the Action that will write it, and the file as a whole, and records the verdict on the rows
 * (valid or invalid, with row-numbered errors). Writes nothing outside the import itself: no contact, account, invoice, journal or
 * statement exists afterwards. Can be repeated; only the verdict of the last run counts.
 */
final class PreviewImport
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ImportKinds $kinds, private readonly ImportGuard $guard, private readonly ImportRows $rows) {}

    public function handle(Actor $actor, string $importId): Import
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $importId): Import {
            $import = $locks->document(Import::query()->findOrFail($importId));
            $kind = $this->kinds->get($import->kind);
            $this->guard->require($actor, $kind, $import->company_id);
            $this->guard->requireOpen($import);
            if (! in_array($import->status, ['mapped', 'previewed'], true) || $import->mapping === null) {
                throw DomainRuleViolation::single('import_state_invalid', $import->mapping === null ? 'Set the column mapping before the preview.' : 'The import has been applied or is being applied.');
            }

            $ctx = new ImportContext(Company::query()->findOrFail($import->company_id), $import, $actor);
            $rows = ImportRow::query()->where('import_id', $import->id)->orderBy('row_number')->get();
            $set = $kind->prepare($ctx, $rows->mapWithKeys(fn (ImportRow $r) => [$r->row_number => $r->cells])->all());

            $valid = [];
            $invalid = 0;
            foreach ($rows as $row) {
                $outcome = $set->rows[$row->row_number] ?? null;
                if ($outcome === null || $outcome->ok()) {
                    $valid[] = $row->id;

                    continue;
                }
                $invalid++;
                $this->rows->markInvalid($row->id, $outcome->errors);
            }
            $this->rows->markValid($valid);

            $import->forceFill([
                'status' => 'previewed', 'rows_valid' => count($valid), 'rows_invalid' => $invalid,
                'errors' => $set->fileErrors === [] ? null : $set->fileErrors, 'result' => ['preview' => $set->summary],
                'lock_version' => $import->lock_version + 1,
            ])->save();
            $import->refresh();
            $audit->add('import.previewed', $import, context: ['rows_valid' => count($valid), 'rows_invalid' => $invalid, 'file_errors' => count($set->fileErrors)]);

            return $import;
        });
    }
}
