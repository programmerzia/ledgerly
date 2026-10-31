<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

final readonly class InviteMemberInput
{
    /** @param list<string> $companyIds companies where the invitee gets $companyRole */
    public function __construct(
        public string $email,
        public string $role,
        public ?string $companyRole = null,
        public array $companyIds = [],
    ) {}
}
