<?php

declare(strict_types=1);

namespace App\Http\Requests\Recurring;

use App\Actions\Recurring\Inputs\RecurringScheduleInput;
use App\Domain\Recurring\Frequency;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;
use Illuminate\Validation\Rule;

/**
 * Create (POST, with the posted `template_id` to copy) or replace (PUT, with `version`; the template cannot change)
 * a recurring schedule. The owner is the maker of its drafts; default: the person creating it.
 */
abstract class RecurringScheduleRequest extends CompanyRequest
{
    /** The table the template lives in. */
    abstract protected function templateTable(): string;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $put = $this->isMethod('PUT');

        return [
            'name' => ['required', 'string', 'max:255'],
            'template_id' => [$put ? 'prohibited' : 'required', 'uuid', $this->inCompany($this->templateTable())],
            'frequency' => ['required', 'string', Rule::in(Frequency::values())],
            'next_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:next_date'],
            'owner_id' => ['nullable', 'uuid', Rule::exists('users', 'id')],
            'version' => [$put ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): RecurringScheduleInput
    {
        $v = $this->validated();

        return new RecurringScheduleInput(
            companyId: $this->company()->id,
            name: trim((string) $v['name']),
            frequency: Frequency::from((string) $v['frequency']),
            nextDate: new DateTimeImmutable((string) $v['next_date']),
            templateId: isset($v['template_id']) ? (string) $v['template_id'] : null,
            endDate: isset($v['end_date']) ? new DateTimeImmutable((string) $v['end_date']) : null,
            ownerId: isset($v['owner_id']) ? (string) $v['owner_id'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
