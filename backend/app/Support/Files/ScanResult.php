<?php

declare(strict_types=1);

namespace App\Support\Files;

/** The scanner's verdict: clean, or infected with the signature it matched. */
final readonly class ScanResult
{
    private function __construct(public bool $clean, public ?string $signature) {}

    public static function clean(): self
    {
        return new self(true, null);
    }

    public static function infected(string $signature): self
    {
        return new self(false, $signature);
    }
}
