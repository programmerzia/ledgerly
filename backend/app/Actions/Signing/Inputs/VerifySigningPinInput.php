<?php

declare(strict_types=1);

namespace App\Actions\Signing\Inputs;

final readonly class VerifySigningPinInput
{
    public function __construct(public string $pin, public string $sessionId) {}
}
