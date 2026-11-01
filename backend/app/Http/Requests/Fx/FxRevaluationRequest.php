<?php

declare(strict_types=1);

namespace App\Http\Requests\Fx;

use App\Actions\Fx\Inputs\RunFxRevaluationInput;
use App\Http\Requests\CompanyRequest;

/** `period_id` (a period of this company; another company's is a 404 from the Action) and an optional `as_of` inside it. Also the preview's query. */
final class FxRevaluationRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'period_id' => ['required', 'uuid'],
            'as_of' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    public function periodId(): string
    {
        return (string) $this->validated()['period_id'];
    }

    public function asOf(): ?string
    {
        $v = $this->validated();

        return isset($v['as_of']) ? (string) $v['as_of'] : null;
    }

    public function toInput(): RunFxRevaluationInput
    {
        return new RunFxRevaluationInput($this->company()->id, $this->periodId(), $this->asOf());
    }
}
