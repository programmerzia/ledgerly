<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Actions\Banking\Inputs\ImportStatementInput;
use App\Domain\Banking\StatementLimits;
use App\Http\Requests\CompanyRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;

/**
 * Multipart statement upload: `file` (at most 2 MB), `format` (csv|ofx|camt|auto, default auto), `mapping` for CSV (a JSON object, or
 * a field per key; see CsvStatementParser), `save_mapping`, and optional `opening_balance` / `closing_balance` in minor units when the
 * file does not state them.
 */
final class ImportStatementRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:'.intdiv(StatementLimits::MAX_BYTES, 1024)],
            'format' => ['nullable', 'string', Rule::in(['auto', 'csv', 'ofx', 'camt'])],
            'mapping' => ['nullable', 'array'],
            'save_mapping' => ['nullable', 'boolean'],
            'opening_balance' => ['nullable', 'integer'],
            'closing_balance' => ['nullable', 'integer'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $mapping = $this->input('mapping');
        if (is_string($mapping) && $mapping !== '') {
            $decoded = json_decode($mapping, true);
            $this->merge(['mapping' => is_array($decoded) ? $decoded : 'invalid']);
        }
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function ($validator): void {
            if ($this->input('mapping') !== null && ! is_array($this->input('mapping'))) {
                $validator->errors()->add('mapping', 'The mapping must be a JSON object.');
            }
        }];
    }

    public function toInput(string $bankAccountId): ImportStatementInput
    {
        $v = $this->validated();
        $file = $this->file('file');
        assert($file instanceof UploadedFile);

        return new ImportStatementInput(
            $this->company()->id, $bankAccountId, (string) file_get_contents($file->getRealPath()), $file->getClientOriginalName(),
            (string) ($v['format'] ?? 'auto'), is_array($v['mapping'] ?? null) ? $v['mapping'] : [], (bool) ($v['save_mapping'] ?? false),
            isset($v['opening_balance']) ? (int) $v['opening_balance'] : null, isset($v['closing_balance']) ? (int) $v['closing_balance'] : null,
        );
    }
}
