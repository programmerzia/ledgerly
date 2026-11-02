<?php

declare(strict_types=1);

namespace App\Http\Requests\Imports;

use App\Actions\Imports\Inputs\CreateImportInput;
use App\Domain\Banking\DateParser;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Requests\CompanyRequest;
use App\Services\Imports\ImportKinds;
use App\Services\Imports\SpreadsheetReader;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;

/**
 * Multipart upload of a CSV or XLSX file: `kind` (contacts, accounts, opening_balances, invoices, bank_lines), `file` (up to
 * `imports.max_bytes`), optional `delimiter` for CSV (default: detected), and `options` — `number_locale` (us|eu|plain, default plain),
 * `date_format` (default Y-m-d) and the kind's own: `as_of` for opening balances, `bank_account_id` (and `sign`, `opening_balance`,
 * `closing_balance`) for bank lines. The file is read here and only its rows are kept. Row and column limits come from config.
 */
final class UploadImportRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'kind' => ['required', 'string', Rule::in(ImportKinds::keys())],
            'file' => ['required', 'file', 'max:'.max(1, intdiv((int) config('imports.max_bytes'), 1024))],
            'delimiter' => ['nullable', 'string', Rule::in([',', ';', "\t", '|'])],
            'options' => ['nullable', 'array'],
            'options.number_locale' => ['nullable', 'string', Rule::in(['us', 'eu', 'plain'])],
            'options.date_format' => ['nullable', 'string', Rule::in(DateParser::FORMATS)],
        ];
        $kind = $this->input('kind');
        if (is_string($kind) && in_array($kind, ImportKinds::keys(), true)) {
            foreach (app(ImportKinds::class)->get($kind)->optionRules($this->company()) as $key => $rule) {
                $rules["options.{$key}"] = $rule;
            }
        }

        return $rules;
    }

    protected function prepareForValidation(): void
    {
        // Multipart sends `options` as a JSON string from simple clients; accept both that and options[key]=value fields.
        $options = $this->input('options');
        if (is_string($options) && $options !== '') {
            $decoded = json_decode($options, true);
            $this->merge(['options' => is_array($decoded) ? $decoded : 'invalid']);
        }
    }

    public function toInput(): CreateImportInput
    {
        $v = $this->validated();
        $file = $this->file('file');
        assert($file instanceof UploadedFile);
        $path = $file->getRealPath();
        if ($path === false) {
            throw DomainRuleViolation::single('import_file_unreadable', 'The upload could not be read.');
        }

        $reader = SpreadsheetReader::fromConfig();
        $format = SpreadsheetReader::formatOf($path, $file->getClientOriginalName());
        $sheet = $reader->read($path, $format, isset($v['delimiter']) ? (string) $v['delimiter'] : null);

        /** @var array<string, mixed> $options */
        $options = array_filter((array) ($v['options'] ?? []), fn ($o) => $o !== null && $o !== '');

        return new CreateImportInput($this->company()->id, (string) $v['kind'], $sheet, $file->getClientOriginalName(), $options);
    }
}
