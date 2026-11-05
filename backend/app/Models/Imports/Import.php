<?php

declare(strict_types=1);

namespace App\Models\Imports;

use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One uploaded file, parsed into rows, mapped, previewed and applied (plan 2.18). The file itself is not kept.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $kind contacts | accounts | opening_balances | invoices | bank_lines
 * @property string $status uploaded | mapped | previewed | queued | applying | completed | failed
 * @property string|null $source_name
 * @property string $source_format csv | xlsx
 * @property list<string> $columns
 * @property array<string, mixed>|null $suggested_mapping
 * @property string|null $suggestion_source saved | headers
 * @property array<string, mixed>|null $mapping
 * @property array<string, mixed> $options
 * @property int $rows_total
 * @property int $rows_valid
 * @property int $rows_invalid
 * @property int $rows_applied
 * @property int $rows_failed
 * @property list<array<string, mixed>>|null $errors
 * @property array<string, mixed>|null $result
 * @property string $created_by
 * @property string|null $requested_by
 * @property string|null $signed_by
 * @property DateTimeImmutable|null $signed_at
 * @property DateTimeImmutable|null $queued_at
 * @property DateTimeImmutable|null $started_at
 * @property DateTimeImmutable|null $finished_at
 * @property DateTimeImmutable|null $rows_purged_at
 * @property int $lock_version
 * @property DateTimeImmutable $created_at
 */
class Import extends BaseModel
{
    public const array KINDS = ['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines', 'budget_lines'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'columns' => 'array', 'suggested_mapping' => 'array', 'mapping' => 'array', 'options' => 'array', 'errors' => 'array', 'result' => 'array',
            'rows_total' => 'integer', 'rows_valid' => 'integer', 'rows_invalid' => 'integer', 'rows_applied' => 'integer', 'rows_failed' => 'integer',
            'signed_at' => 'immutable_datetime', 'queued_at' => 'immutable_datetime', 'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime', 'rows_purged_at' => 'immutable_datetime', 'created_at' => 'immutable_datetime', 'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<ImportRow, $this> */
    public function rows(): HasMany
    {
        return $this->hasMany(ImportRow::class)->orderBy('row_number');
    }

    public function isFinished(): bool
    {
        return in_array($this->status, ['completed', 'failed'], true);
    }
}
