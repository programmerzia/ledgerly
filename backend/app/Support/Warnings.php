<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Warnings collected while one request is handled (bound per request). A transition that goes ahead but wants the person to know
 * something, such as a credit limit that is exceeded in `warn` mode, adds one here; the controller puts them in the response `warnings`.
 */
final class Warnings
{
    /** @var list<array{code: string, message: string}> */
    private array $items = [];

    public function add(string $code, string $message): void
    {
        $this->items[] = ['code' => $code, 'message' => $message];
    }

    /** Forget what an earlier request in the same process collected. */
    public function clear(): void
    {
        $this->items = [];
    }

    /** @return list<array{code: string, message: string}> */
    public function all(): array
    {
        return $this->items;
    }
}
