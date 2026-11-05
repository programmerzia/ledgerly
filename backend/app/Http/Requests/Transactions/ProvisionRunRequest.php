<?php

declare(strict_types=1);

namespace App\Http\Requests\Transactions;

use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** `as_of` (and an optional memo) for a provisioning preview or run. The run's date must be in an open period. */
final class ProvisionRunRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['as_of' => ['required', 'date_format:Y-m-d'], 'memo' => ['nullable', 'string', 'max:5000']];
    }

    public function asOf(): DateTimeImmutable
    {
        return new DateTimeImmutable((string) $this->validated()['as_of']);
    }

    public function memo(): ?string
    {
        $v = $this->validated();

        return isset($v['memo']) ? (string) $v['memo'] : null;
    }
}
