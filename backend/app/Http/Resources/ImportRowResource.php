<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Imports\CellSanitizer;
use App\Http\Support\Json;
use App\Models\Imports\ImportRow;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of an import. `row_number` is the row in the sheet (header = row 1). `status`: pending (not checked), valid, invalid
 * (`errors` say why, by field), applied (`result` names what it created: contact_id, account_id, invoice_id, journal_id, statement_id),
 * failed (refused when applied; `errors`). `cells` echo the uploaded text with a leading apostrophe on any text that a spreadsheet
 * would run as a formula (starts with = + - @), so the response is safe to open in Excel; they are empty once the rows are purged.
 *
 * @mixin ImportRow
 */
final class ImportRowResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'row_number' => $this->row_number,
            'status' => $this->status,
            /** @var array<string, string|null> */
            'cells' => (object) CellSanitizer::row($this->cells),
            /** @var list<array{field: string|null, code: string, message: string}> */
            'errors' => $this->errors ?? [],
            /** @var array<string, mixed>|null */
            'result' => $this->result,
            'applied_at' => Json::time($this->applied_at),
        ];
    }
}
