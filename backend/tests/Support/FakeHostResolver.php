<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\HostResolver;

/**
 * Scripted DNS: each host maps to a list of answers, one per lookup (the last answer repeats), so a test can
 * make a name resolve to a public address first and to an internal one afterwards (DNS rebinding).
 */
final class FakeHostResolver implements HostResolver
{
    /** @var array<string, int> */
    public array $lookups = [];

    /** @param array<string, list<list<string>>> $answers host => answers per lookup */
    public function __construct(private array $answers = []) {}

    /** @param list<list<string>> $answers */
    public function script(string $host, array $answers): self
    {
        $this->answers[$host] = $answers;

        return $this;
    }

    public function resolve(string $host): array
    {
        $n = $this->lookups[$host] = ($this->lookups[$host] ?? 0) + 1;
        $answers = $this->answers[$host] ?? [];

        return $answers === [] ? [] : $answers[min($n, count($answers)) - 1];
    }
}
