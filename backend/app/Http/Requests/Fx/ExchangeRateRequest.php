<?php

declare(strict_types=1);

namespace App\Http\Requests\Fx;

use App\Actions\Fx\Inputs\ExchangeRateInput;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** A manual rate: 1 `from_currency` = `rate` `to_currency` on `rate_date`. The rate is a decimal string (D1: up to 8 decimals). */
final class ExchangeRateRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from_currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/', Rule::exists('currencies', 'code')],
            'to_currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/', Rule::exists('currencies', 'code'), 'different:from_currency'],
            'rate_date' => ['required', 'date_format:Y-m-d'],
            'rate' => ['required', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
        ];
    }

    public function toInput(): ExchangeRateInput
    {
        $v = $this->validated();

        return new ExchangeRateInput($this->company()->id, (string) $v['from_currency'], (string) $v['to_currency'], (string) $v['rate_date'], (string) $v['rate']);
    }
}
