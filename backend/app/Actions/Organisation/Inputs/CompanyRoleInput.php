<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

final readonly class CompanyRoleInput
{
    public function __construct(public string $userId, public string $companyId, public string $roleName) {}
}
