<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Actions\Imports\Inputs\SetMappingInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\ImportRows;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Sets which column feeds which field (and constants for empty cells, and the import's options). Allowed until apply is requested;
 * changing it clears the previous preview, so what is applied is always what was previewed with this mapping.
 */
final class SetImportMapping
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ImportKinds $kinds, private readonly ImportGuard $guard, private readonly ImportRows $rows) {}

    public function handle(Actor $actor, string $importId, int $version, SetMappingInput $in): Import
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $importId, $version, $in): Import {
            $import = $locks->document(Import::query()->findOrFail($importId), $version);
            $kind = $this->kinds->get($import->kind);
            $this->guard->require($actor, $kind, $import->company_id);
            $this->guard->requireOpen($import);
            if (! in_array($import->status, ['uploaded', 'mapped', 'previewed'], true)) {
                throw DomainRuleViolation::single('import_state_invalid', 'The mapping can no longer change: the import has been applied or is being applied.');
            }

            $fields = $kind->fieldMap();
            $problems = [];
            foreach ($in->columns as $field => $header) {
                if (! isset($fields[$field])) {
                    $problems[] = new Violation('mapping_invalid', "'{$field}' is not a field of a {$import->kind} import.");
                } elseif (! in_array($header, $import->columns, true)) {
                    $problems[] = new Violation('mapping_invalid', "The file has no column '{$header}' (mapped to {$field}).");
                }
            }
            foreach (array_keys($in->defaults) as $field) {
                if (! isset($fields[$field])) {
                    $problems[] = new Violation('mapping_invalid', "'{$field}' is not a field of a {$import->kind} import.");
                }
            }
            foreach ($fields as $key => $spec) {
                if ($spec->required && ! isset($in->columns[$key]) && ! isset($in->defaults[$key])) {
                    $problems[] = new Violation('mapping_required', "Map a column to '{$spec->label}'.");
                }
            }
            foreach ($kind->mappingProblems($in->columns, $in->defaults) as $message) {
                $problems[] = new Violation('mapping_invalid', $message);
            }
            $options = $in->options ?? $import->options;
            foreach ($kind->missingOptions($options) as $name) {
                $problems[] = new Violation('option_required', "The option '{$name}' is needed for a {$import->kind} import.");
            }
            if ($problems !== []) {
                throw new DomainRuleViolation('mapping_invalid', 'The mapping is not usable.', $problems);
            }

            $before = ['mapping' => $import->mapping, 'status' => $import->status];
            $import->forceFill([
                'mapping' => ['columns' => $in->columns, 'defaults' => (object) $in->defaults], 'options' => $options, 'status' => 'mapped',
                'rows_valid' => 0, 'rows_invalid' => 0, 'errors' => null, 'result' => null, 'lock_version' => $import->lock_version + 1,
            ])->save();
            $this->rows->reset($import->id);
            $import->refresh();
            $audit->add('import.mapped', $import, before: $before, after: ['mapping' => $import->mapping]);

            return $import;
        });
    }
}
