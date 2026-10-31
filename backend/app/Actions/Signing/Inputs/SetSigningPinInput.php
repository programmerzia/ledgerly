<?php

declare(strict_types=1);

namespace App\Actions\Signing\Inputs;

final readonly class SetSigningPinInput
{
    public function __construct(public string $pin, public string $sessionId) {}
}
