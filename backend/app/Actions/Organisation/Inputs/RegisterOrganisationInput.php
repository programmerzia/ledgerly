<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

/** Ids are minted by the caller so the tenant context can be set before the Action runs. */
final readonly class RegisterOrganisationInput
{
    public function __construct(
        public string $tenantId,
        public string $userId,
        public string $name,
        public string $email,
        public string $passwordHash,
        public string $organisationName,
    ) {}
}
