<?php

declare(strict_types=1);

namespace App\Actions\Documents\Inputs;

final readonly class DunningInput
{
    /** @param list<array{id: string|null, days_after_due: int, subject: string, body: string}> $stages the whole list, in any order */
    public function __construct(public string $companyId, public bool $enabled, public array $stages, public ?int $version = null) {}
}
