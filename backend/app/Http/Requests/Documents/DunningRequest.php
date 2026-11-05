<?php

declare(strict_types=1);

namespace App\Http\Requests\Documents;

use App\Actions\Documents\Inputs\DunningInput;
use App\Actions\Documents\ManageDunning;
use App\Http\Requests\CompanyRequest;
use App\Models\Trade\DunningStage;

/** Replace the overdue-invoice reminder settings: on or off, and the whole list of stages. */
final class DunningRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'enabled' => ['required', 'boolean'],
            'stages' => ['present', 'array', 'max:'.ManageDunning::MAX_STAGES],
            'stages.*.id' => ['nullable', 'uuid'],
            'stages.*.days_after_due' => ['required', 'integer', 'between:1,365'],
            'stages.*.subject' => ['required', 'string', 'max:200'],
            'stages.*.body' => ['required', 'string', 'max:5000'],
            /** Send what you loaded: a stale value answers 409. */
            'version' => ['sometimes', 'integer', 'min:0'],
        ];
    }

    public function toInput(): DunningInput
    {
        $v = $this->validated();
        $own = DunningStage::query()->where('company_id', $this->company()->id)->pluck('id')->all();
        /** @var list<array{id?: string|null, days_after_due: int, subject: string, body: string}> $stages */
        $stages = $v['stages'];

        return new DunningInput(
            $this->company()->id, (bool) $v['enabled'],
            array_map(fn (array $s): array => [
                // An id from another company is treated as "no id": it can never reach that company's stage.
                'id' => isset($s['id']) && in_array($s['id'], $own, true) ? $s['id'] : null,
                'days_after_due' => (int) $s['days_after_due'], 'subject' => trim($s['subject']), 'body' => trim($s['body']),
            ], $stages),
            isset($v['version']) ? (int) $v['version'] : null,
        );
    }
}
