<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\Inputs\InviteMemberInput;
use Illuminate\Foundation\Http\FormRequest;

final class InviteMemberRequest extends FormRequest
{
    /** Authorization is the Action's guard (org owner or admin). */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'role' => ['required', 'string', 'in:owner,admin,member'],
            'company_role' => ['nullable', 'string', 'max:64'],
            'company_ids' => ['array', 'max:100'],
            'company_ids.*' => ['uuid'],
        ];
    }

    public function toInput(): InviteMemberInput
    {
        $v = $this->validated();

        /** @var list<string> $companyIds */
        $companyIds = array_values(array_map('strval', (array) ($v['company_ids'] ?? [])));

        return new InviteMemberInput(
            (string) $v['email'], (string) $v['role'],
            isset($v['company_role']) ? (string) $v['company_role'] : null, $companyIds,
        );
    }
}
