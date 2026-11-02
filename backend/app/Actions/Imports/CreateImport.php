<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Actions\Imports\Inputs\CreateImportInput;
use App\Contracts\IdGenerator;
use App\Events\Imports\ImportCreated;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\ImportRows;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Stores a parsed upload: the import and one row per data row (the file is not kept). Suggests a mapping: the company's last used
 * mapping for this kind when all its columns are in this file ("saved"), else one guessed from the header names ("headers").
 * Needs the permission of the kind; people only.
 */
final class CreateImport
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly ImportKinds $kinds,
        private readonly ImportGuard $guard,
        private readonly ImportRows $rows,
    ) {}

    public function handle(Actor $actor, CreateImportInput $in): Import
    {
        $kind = $this->kinds->get($in->kind);

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in, $kind): Import {
            $this->guard->require($actor, $kind, $in->companyId);

            [$suggested, $source] = $this->suggestion($in->companyId, $in->kind, $in->sheet->headers) ?? [$kind->suggest($in->sheet->headers), 'headers'];
            $import = new Import;
            $import->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'kind' => $in->kind, 'status' => 'uploaded',
                'source_name' => $in->sourceName === null ? null : mb_substr($in->sourceName, 0, 255), 'source_format' => $in->sheet->format,
                'columns' => $in->sheet->headers, 'suggested_mapping' => ['columns' => $suggested, 'defaults' => (object) []], 'suggestion_source' => $source,
                'options' => $in->options, 'rows_total' => count($in->sheet->rows), 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();

            $this->rows->store($import, $in->sheet);

            $import->refresh();
            $audit->add('import.created', $import, after: $import, context: ['kind' => $in->kind, 'rows' => $import->rows_total, 'format' => $import->source_format]);
            $outbox->add(new ImportCreated($import->id, $import->company_id, 0, ['kind' => $import->kind, 'rows' => $import->rows_total]));

            return $import;
        });
    }

    /**
     * @param  list<string>  $headers
     * @return array{0: array<string, string>, 1: string}|null
     */
    private function suggestion(string $companyId, string $kind, array $headers): ?array
    {
        $previous = Import::query()->where('company_id', $companyId)->where('kind', $kind)->whereIn('status', ['previewed', 'queued', 'applying', 'completed'])
            ->whereNotNull('mapping')->orderByDesc('created_at')->orderByDesc('id')->limit(10)->get();
        foreach ($previous as $import) {
            /** @var array<string, string> $columns */
            $columns = (array) ($import->mapping['columns'] ?? []);
            if ($columns !== [] && array_diff(array_values($columns), $headers) === []) {
                return [$columns, 'saved'];
            }
        }

        return null;
    }
}
