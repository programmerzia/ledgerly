<?php

declare(strict_types=1);

namespace App\Http\Requests;

/** A document transition (submit, approve): the version it was based on is optional, a comment too. */
final class TransitionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'version' => ['nullable', 'integer', 'min:0'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }

    public function comment(): ?string
    {
        $v = $this->validated();

        return isset($v['comment']) ? trim((string) $v['comment']) : null;
    }
}
