<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\Inputs\CreateCompanyInput;
use Illuminate\Foundation\Http\FormRequest;

final class CreateCompanyRequest extends FormRequest
{
    /** Authorization is the Action's guard (org owner or admin). */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'country' => ['required', 'string', 'size:2', 'alpha'],
            'base_currency' => ['required', 'string', 'size:3', 'alpha'],
            'fiscal_year_start_month' => ['required', 'integer', 'between:1,12'],
            'tax_id' => ['nullable', 'string', 'max:64'],
            'timezone' => ['nullable', 'string', 'timezone:all'],
        ];
    }

    public function toInput(): CreateCompanyInput
    {
        $v = $this->validated();

        return new CreateCompanyInput(
            name: trim((string) $v['name']),
            country: (string) $v['country'],
            baseCurrency: (string) $v['base_currency'],
            fiscalYearStartMonth: (int) $v['fiscal_year_start_month'],
            legalName: isset($v['legal_name']) ? trim((string) $v['legal_name']) : null,
            taxId: isset($v['tax_id']) ? trim((string) $v['tax_id']) : null,
            timezone: isset($v['timezone']) ? (string) $v['timezone'] : 'UTC',
        );
    }
}
