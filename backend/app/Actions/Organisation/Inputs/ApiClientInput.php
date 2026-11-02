<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

use DateTimeImmutable;

final readonly class ApiClientInput
{
    /**
     * @param  list<string>  $companyIds  the companies the client may work in
     * @param  list<string>  $abilities  from ApiTokenAbilities::ALL
     */
    public function __construct(
        public string $name,
        public array $companyIds,
        public array $abilities,
        public ?DateTimeImmutable $expiresAt = null,
        public string $tokenName = 'default',
    ) {}
}
