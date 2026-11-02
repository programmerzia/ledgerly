<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Imports\CellSanitizer;
use App\Http\Support\Json;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An import and where it stands. `status`: uploaded (rows read, mapping not set), mapped, previewed (every row checked; see
 * `rows_invalid` and `errors`), queued, applying, completed (rows may still have failed: see `rows_failed` and the rows), failed
 * (an all-or-nothing import, opening balances, was refused as a whole). `mapping` and `suggested_mapping` are
 * `{columns: {field: header}, defaults: {field: constant}}`. `errors` are about the file as a whole; row errors are on the rows.
 * `fields` lists what the mapping can target. Names that came from the file are shown safe for spreadsheets (see rows).
 *
 * @mixin Import
 */
final class ImportResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $kind = app(ImportKinds::class)->get($this->kind);

        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'status' => $this->status,
            'source_name' => CellSanitizer::forOutput($this->source_name),
            'source_format' => $this->source_format,
            'columns' => $this->columns,
            /** @var array{columns: array<string, string>, defaults: array<string, string>}|null */
            'suggested_mapping' => $this->suggested_mapping === null ? null : ['columns' => (array) ($this->suggested_mapping['columns'] ?? []), 'defaults' => (array) ($this->suggested_mapping['defaults'] ?? [])],
            'suggestion_source' => $this->suggestion_source,
            /** @var array{columns: array<string, string>, defaults: array<string, string>}|null */
            'mapping' => $this->mapping === null ? null : ['columns' => (array) ($this->mapping['columns'] ?? []), 'defaults' => (array) ($this->mapping['defaults'] ?? [])],
            /** @var array<string, mixed> */
            'options' => (object) $this->options,
            'rows_total' => $this->rows_total,
            'rows_valid' => $this->rows_valid,
            'rows_invalid' => $this->rows_invalid,
            'rows_applied' => $this->rows_applied,
            'rows_failed' => $this->rows_failed,
            /** @var list<array{code: string, message: string}> */
            'errors' => $this->errors ?? [],
            'result' => $this->result,
            'all_or_nothing' => (bool) $kind->atomic(),
            'needs_signature' => (bool) $kind->needsSignature(),
            'permission' => (string) $kind->permission(),
            /** @var list<array{key: string, label: string, required: bool, note: string|null}> */
            'fields' => array_map(fn ($f) => $f->toArray(), $kind->fields()),
            'created_by' => $this->created_by,
            'requested_by' => $this->requested_by,
            'signed_by' => $this->signed_by,
            'signed_at' => Json::time($this->signed_at),
            'queued_at' => Json::time($this->queued_at),
            'started_at' => Json::time($this->started_at),
            'finished_at' => Json::time($this->finished_at),
            'rows_purged_at' => Json::time($this->rows_purged_at),
            'created_at' => Json::time($this->created_at),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'apply' => 'apply', 'purge' => 'purge']),
        ];
    }
}
