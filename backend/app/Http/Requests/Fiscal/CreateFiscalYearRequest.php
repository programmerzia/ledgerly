<?php

declare(strict_types=1);

namespace App\Http\Requests\Fiscal;

use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** A year of twelve months from `starts_on`, plus its adjustment period. */
final class CreateFiscalYearRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:32'],
            'starts_on' => ['required', 'date_format:Y-m-d'],
        ];
    }

    public function toInput(): CreateFiscalYearInput
    {
        $v = $this->validated();

        return new CreateFiscalYearInput($this->company()->id, new DateTimeImmutable((string) $v['starts_on']), trim((string) $v['name']));
    }
}
