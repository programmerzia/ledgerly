<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

/**
 * `newUserName` and `newUserPasswordHash` are set when the invitee has no account yet; the actor's
 * id is then the id the new user gets.
 */
final readonly class AcceptInvitationInput
{
    public function __construct(
        public string $invitationId,
        public string $token,
        public ?string $newUserName = null,
        public ?string $newUserPasswordHash = null,
    ) {}

    public function createsUser(): bool
    {
        return $this->newUserPasswordHash !== null;
    }
}
