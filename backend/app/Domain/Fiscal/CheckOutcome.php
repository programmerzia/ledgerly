<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

/** The result of one pre-close check (02_AppFlow §periods checklist). */
final readonly class CheckOutcome
{
    /** @param array<string, mixed> $detail */
    public function __construct(public string $code, public bool $passed, public string $message, public array $detail = []) {}
}
