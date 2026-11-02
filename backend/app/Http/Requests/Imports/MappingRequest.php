<?php

declare(strict_types=1);

namespace App\Http\Requests\Imports;

use App\Actions\Imports\Inputs\SetMappingInput;
use App\Domain\Banking\DateParser;
use App\Http\Requests\CompanyRequest;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKinds;
use Illuminate\Validation\Rule;

/**
 * Sets the mapping of an import: `columns` ({field: file header}), optional `defaults` ({field: constant} for empty cells), and
 * optionally `options` (replaces the current ones: `number_locale`, `date_format`, and the kind's own, see the upload).
 * Carries the `version` the client last read. Setting the mapping clears any earlier preview.
 */
final class MappingRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'version' => ['required', 'integer', 'min:0'],
            'columns' => ['required', 'array'],
            'columns.*' => ['required', 'string', 'max:255'],
            'defaults' => ['nullable', 'array'],
            'defaults.*' => ['nullable', 'string', 'max:255'],
            'options' => ['nullable', 'array'],
            'options.number_locale' => ['nullable', 'string', Rule::in(['us', 'eu', 'plain'])],
            'options.date_format' => ['nullable', 'string', Rule::in(DateParser::FORMATS)],
        ];
        $import = $this->route('import');
        if ($import instanceof Import) {
            foreach (app(ImportKinds::class)->get($import->kind)->optionRules($this->company()) as $key => $rule) {
                $rules["options.{$key}"] = $rule;
            }
        }

        return $rules;
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }

    public function toInput(): SetMappingInput
    {
        $v = $this->validated();
        /** @var array<string, string> $columns */
        $columns = $v['columns'];
        /** @var array<string, string> $defaults */
        $defaults = array_filter((array) ($v['defaults'] ?? []), fn ($d) => $d !== null && $d !== '');
        /** @var array<string, mixed>|null $options */
        $options = isset($v['options']) ? array_filter((array) $v['options'], fn ($o) => $o !== null && $o !== '') : null;

        return new SetMappingInput($columns, $defaults, $options);
    }
}
