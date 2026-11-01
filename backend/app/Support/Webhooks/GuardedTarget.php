<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

/** A webhook URL that passed the SSRF guard, with the one address the connection is pinned to. */
final readonly class GuardedTarget
{
    public function __construct(
        public string $url,
        public string $scheme,
        public string $host,
        public int $port,
        public string $ip,
    ) {}

    /** The URL names the address itself, so there is nothing to pin. */
    public function isLiteral(): bool
    {
        return inet_pton($this->host) !== false;
    }

    /** The curl CURLOPT_RESOLVE entry that forces the connection to the validated address. */
    public function curlResolve(): string
    {
        return "{$this->host}:{$this->port}:{$this->ip}";
    }
}
