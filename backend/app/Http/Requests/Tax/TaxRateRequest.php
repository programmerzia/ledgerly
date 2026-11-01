<?php

declare(strict_types=1);

namespace App\Http\Requests\Tax;

use App\Actions\Tax\Inputs\TaxRateInput;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** A new rate of a tax code from a date (inclusive), with the code's `version` it was based on. */
final class TaxRateRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'rate' => ['required', 'string', 'regex:'.TaxCodeRequest::RATE_PATTERN],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'effective_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:effective_from'],
            'version' => ['required', 'integer', 'min:0'],
        ];
    }

    public function toInput(): TaxRateInput
    {
        $v = $this->validated();

        return new TaxRateInput(
            (string) $v['rate'],
            new DateTimeImmutable((string) $v['effective_from']),
            isset($v['effective_to']) ? new DateTimeImmutable((string) $v['effective_to']) : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
