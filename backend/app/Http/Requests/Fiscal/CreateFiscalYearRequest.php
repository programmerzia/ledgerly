<?php

declare(strict_types=1);

namespace App\Http\Requests\Fiscal;

use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Domain\Fiscal\CalendarType;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;
use Illuminate\Validation\Rule;

/** A year of twelve periods from `starts_on` (calendar months by default, or 52 weeks in a week pattern), plus its adjustment period. */
final class CreateFiscalYearRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:32'],
            'starts_on' => ['required', 'date_format:Y-m-d'],
            'calendar' => ['sometimes', Rule::enum(CalendarType::class)],
            'extra_week_period' => ['sometimes', 'nullable', 'integer', 'between:1,12'],
        ];
    }

    public function toInput(): CreateFiscalYearInput
    {
        $v = $this->validated();

        return new CreateFiscalYearInput(
            $this->company()->id, new DateTimeImmutable((string) $v['starts_on']), trim((string) $v['name']),
            CalendarType::from((string) ($v['calendar'] ?? CalendarType::Monthly->value)),
            isset($v['extra_week_period']) ? (int) $v['extra_week_period'] : null,
        );
    }
}
