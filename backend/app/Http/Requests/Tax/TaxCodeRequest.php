<?php

declare(strict_types=1);

namespace App\Http\Requests\Tax;

use App\Actions\Tax\Inputs\TaxCodeInput;
use App\Actions\Tax\Inputs\TaxRateInput;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;
use Illuminate\Validation\Rule;

/**
 * Create (POST: the code, and optionally its first rate) and replace (PUT: everything but the code, with the
 * `version` it was based on) a tax code. Rates are fractions as strings: "0.05" is 5%.
 */
final class TaxCodeRequest extends CompanyRequest
{
    public const array KINDS = ['vat', 'gst', 'sales', 'wht', 'compound', 'exempt', 'zero', 'reverse_charge'];

    public const string RATE_PATTERN = '/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/';

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'code' => [$update ? 'prohibited' : 'required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'kind' => ['required', 'string', Rule::in(self::KINDS)],
            'collect_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'pay_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'is_recoverable' => ['nullable', 'boolean'],
            'rate' => [$update ? 'prohibited' : 'nullable', 'string', 'regex:'.self::RATE_PATTERN, 'required_with:effective_from'],
            'effective_from' => [$update ? 'prohibited' : 'nullable', 'date_format:Y-m-d', 'required_with:rate'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(?string $code = null): TaxCodeInput
    {
        $v = $this->validated();

        return new TaxCodeInput(
            companyId: $this->company()->id,
            code: trim((string) ($v['code'] ?? $code ?? '')),
            name: trim((string) $v['name']),
            kind: (string) $v['kind'],
            collectAccountId: $v['collect_account_id'] ?? null,
            payAccountId: $v['pay_account_id'] ?? null,
            isRecoverable: (bool) ($v['is_recoverable'] ?? false),
        );
    }

    /** The first rate of a new code, when the request names one. */
    public function firstRate(): ?TaxRateInput
    {
        $v = $this->validated();

        return isset($v['rate'], $v['effective_from'])
            ? new TaxRateInput((string) $v['rate'], new DateTimeImmutable((string) $v['effective_from']))
            : null;
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
