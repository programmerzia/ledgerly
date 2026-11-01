<?php

declare(strict_types=1);

namespace App\Http\Requests;

/** A change that must name the version it was based on (13 §11): `{"version": 3}`. */
final class VersionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['version' => ['required', 'integer', 'min:0']];
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
