<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Who performs an Action (13 §4). Built once by middleware or job middleware and passed
 * explicitly; Actions never read auth() or request().
 */
final readonly class Actor
{
    public function __construct(
        public ActorType $type,
        public ?string $id,
        public string $tenantId,
        public ?string $companyId = null,
        public bool $hasSigningGrant = false,
        public ?string $ip = null,
        public ?string $userAgent = null,
        public ?string $requestId = null,
        public ?string $idempotencyKey = null,
    ) {}

    public static function system(string $tenantId, ?string $companyId = null): self
    {
        return new self(ActorType::System, null, $tenantId, $companyId);
    }

    public function isApiClient(): bool
    {
        return $this->type === ActorType::ApiClient;
    }
}
