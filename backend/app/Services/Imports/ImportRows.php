<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Imports\ParsedSheet;
use App\Models\Imports\Import;
use Illuminate\Database\DatabaseManager;

/** Bulk writes on `import_rows` for the import Actions (Actions never touch the DB facade): store, reset, mark and purge. */
final class ImportRows
{
    public function __construct(private readonly DatabaseManager $db, private readonly IdGenerator $ids, private readonly Clock $clock) {}

    /** Stores the sheet's rows as `pending`, 500 to an insert. */
    public function store(Import $import, ParsedSheet $sheet): void
    {
        $now = $this->stamp();
        $batch = [];
        foreach ($sheet->rows as $number => $cells) {
            $batch[] = [
                'id' => $this->ids->next(), 'tenant_id' => $import->tenant_id, 'company_id' => $import->company_id, 'import_id' => $import->id,
                'row_number' => $number, 'cells' => json_encode($cells, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), 'status' => 'pending',
                'created_at' => $now, 'updated_at' => $now,
            ];
            if (count($batch) === 500) {
                $this->db->table('import_rows')->insert($batch);
                $batch = [];
            }
        }
        if ($batch !== []) {
            $this->db->table('import_rows')->insert($batch);
        }
    }

    /** Back to `pending` with no errors: the mapping changed, so the old verdict is void. */
    public function reset(string $importId): void
    {
        $this->db->table('import_rows')->where('import_id', $importId)->update(['status' => 'pending', 'errors' => null, 'updated_at' => $this->stamp()]);
    }

    /** @param list<string> $rowIds */
    public function markValid(array $rowIds): void
    {
        foreach (array_chunk($rowIds, 1000) as $chunk) {
            $this->db->table('import_rows')->whereIn('id', $chunk)->update(['status' => 'valid', 'errors' => null, 'updated_at' => $this->stamp()]);
        }
    }

    /** @param list<array{field: string|null, code: string, message: string}> $errors */
    public function markInvalid(string $rowId, array $errors): void
    {
        $this->db->table('import_rows')->where('id', $rowId)->update(['status' => 'invalid', 'errors' => json_encode($errors, JSON_THROW_ON_ERROR), 'updated_at' => $this->stamp()]);
    }

    /** Clears the cell text of every row (retention); status, errors and results stay. */
    public function purgeCells(string $importId): void
    {
        $this->db->table('import_rows')->where('import_id', $importId)->update(['cells' => '{}', 'updated_at' => $this->stamp()]);
    }

    private function stamp(): string
    {
        return $this->clock->now()->format('Y-m-d H:i:s.uP');
    }
}
