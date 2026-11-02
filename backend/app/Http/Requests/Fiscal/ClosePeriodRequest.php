<?php

declare(strict_types=1);

namespace App\Http\Requests\Fiscal;

use App\Http\Requests\CompanyRequest;

/** `{"waivers": {"DRAFTS": "reason it is acceptable"}}`: failing checks the closer accepts. */
final class ClosePeriodRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'waivers' => ['nullable', 'array', 'max:20'],
            'waivers.*' => ['required', 'string', 'max:1000'],
        ];
    }

    /** @return array<string, string> check code → reason */
    public function waivers(): array
    {
        /** @var array<string, string> $waivers */
        $waivers = $this->validated()['waivers'] ?? [];

        return $waivers;
    }
}
