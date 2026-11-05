<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\CreateCompanyRole;
use App\Http\Requests\CompanyRequest;

/** A custom role's name and its complete set of permission names (names the matrix does not have are refused by the Action). */
final class CompanyRoleRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => [$this->isMethod('POST') ? 'required' : 'sometimes', 'string', 'max:'.CreateCompanyRole::MAX_NAME],
            'permissions' => ['present', 'array', 'max:200'],
            'permissions.*' => ['string', 'max:100'],
        ];
    }

    /** @return list<string> */
    public function permissions(): array
    {
        /** @var list<string> */
        return array_values($this->validated('permissions') ?? []);
    }

    public function roleName(): ?string
    {
        $name = $this->validated('name');

        return is_string($name) ? $name : null;
    }
}
