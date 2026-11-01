<?php

declare(strict_types=1);

namespace App\Contracts;

/** Resolves a hostname to its IP addresses (A and AAAA). Behind a contract so tests can script DNS, including rebinding. */
interface HostResolver
{
    /** @return list<string> every address the name currently resolves to; empty when it does not resolve */
    public function resolve(string $host): array;
}
