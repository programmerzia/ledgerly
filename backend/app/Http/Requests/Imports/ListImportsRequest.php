<?php

declare(strict_types=1);

namespace App\Http\Requests\Imports;

use App\Http\Requests\CompanyRequest;
use App\Models\Imports\Import;
use Illuminate\Validation\Rule;

/** Filters of GET /imports and /imports/{id}/rows. */
final class ListImportsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'string', Rule::in(Import::KINDS)],
            'status' => ['nullable', 'string', Rule::in(['uploaded', 'mapped', 'previewed', 'queued', 'applying', 'completed', 'failed', 'pending', 'valid', 'invalid', 'applied'])],
        ];
    }

    public function kind(): ?string
    {
        $v = $this->validated();

        return isset($v['kind']) ? (string) $v['kind'] : null;
    }

    public function status(): ?string
    {
        $v = $this->validated();

        return isset($v['status']) ? (string) $v['status'] : null;
    }
}
