<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Domain\Organisation\NumberingKinds;
use App\Http\Requests\CompanyRequest;
use Illuminate\Contracts\Validation\Validator;

/** Prefix and padding for one document kind, from the next fiscal year. `version` is the waiting change's version, when there is one. */
final class NumberingRuleRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'prefix' => ['required', 'string', 'max:'.NumberingKinds::MAX_PREFIX],
            'padding' => ['required', 'integer', 'between:'.NumberingKinds::MIN_PADDING.','.NumberingKinds::MAX_PADDING],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v): void {
            $prefix = $this->input('prefix');
            if (is_string($prefix) && ($problems = NumberingKinds::prefixProblems($prefix)) !== []) {
                $v->errors()->add('prefix', $problems[0]);
            }
        });
    }

    public function prefix(): string
    {
        return (string) $this->validated()['prefix'];
    }

    public function padding(): int
    {
        return (int) $this->validated()['padding'];
    }

    public function version(): ?int
    {
        $v = $this->validated()['version'] ?? null;

        return $v === null ? null : (int) $v;
    }
}
