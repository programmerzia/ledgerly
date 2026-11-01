<?php

declare(strict_types=1);

namespace App\Http\Requests\Fx;

use App\Http\Requests\CompanyRequest;

/** Filter of GET /fx-revaluations: `period_id`. */
final class ListFxRevaluationsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['period_id' => ['nullable', 'uuid']];
    }

    public function periodId(): ?string
    {
        $v = $this->validated();

        return isset($v['period_id']) ? (string) $v['period_id'] : null;
    }
}
