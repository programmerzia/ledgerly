<?php

declare(strict_types=1);

namespace App\Models\Imports;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * One data row of an import. `row_number` is the row's position in the sheet (the header is row 1), so an error can be found in
 * Excel; `cells` holds the text of each cell by header until the rows are purged.
 *
 * @property string $id
 * @property string $import_id
 * @property int $row_number
 * @property array<string, string> $cells
 * @property string $status pending | valid | invalid | applied | failed
 * @property list<array{field: string|null, code: string, message: string}>|null $errors
 * @property array<string, mixed>|null $result
 * @property DateTimeImmutable|null $applied_at
 */
class ImportRow extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['cells' => 'array', 'errors' => 'array', 'result' => 'array', 'row_number' => 'integer', 'applied_at' => 'immutable_datetime'];
    }
}
