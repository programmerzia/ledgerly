<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\Inputs\ApiClientInput;
use App\Domain\Organisation\ApiTokenAbilities;
use DateTimeImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Create a client with its first token (POST /api-clients) or another token for it (POST /api-clients/{id}/tokens).
 * Abilities come from the fixed list; there is no approve ability and no wildcard.
 */
final class ApiClientRequest extends FormRequest
{
    /** Authorization is the route's policy and the Action's role check. */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $creating = $this->route('apiClient') === null;

        return [
            'name' => [$creating ? 'required' : 'prohibited', 'string', 'max:255'],
            'company_ids' => [$creating ? 'required' : 'prohibited', 'array', 'min:1', 'max:50'],
            'company_ids.*' => ['uuid', 'distinct', Rule::exists('companies', 'id')],
            'token_name' => ['nullable', 'string', 'max:100'],
            'abilities' => ['required', 'array', 'min:1', 'max:'.count(ApiTokenAbilities::ALL)],
            'abilities.*' => ['string', 'distinct', Rule::in(ApiTokenAbilities::ALL)],
            'expires_at' => ['nullable', 'date_format:Y-m-d\TH:i:s\Z', 'after:now', 'before:+2 years'],
        ];
    }

    public function toInput(): ApiClientInput
    {
        $v = $this->validated();

        return new ApiClientInput(
            name: trim((string) ($v['name'] ?? '')),
            companyIds: array_values(array_map('strval', (array) ($v['company_ids'] ?? []))),
            abilities: array_values(array_map('strval', (array) $v['abilities'])),
            expiresAt: isset($v['expires_at']) ? new DateTimeImmutable((string) $v['expires_at']) : null,
            tokenName: trim((string) ($v['token_name'] ?? '')) ?: 'default',
        );
    }
}
