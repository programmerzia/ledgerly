<?php

declare(strict_types=1);

namespace App\Actions\Fiscal\Inputs;

final readonly class ClosePeriodInput
{
    /** @param array<string, string> $waivers failing check code → reason it is acceptable */
    public function __construct(public string $periodId, public array $waivers = []) {}
}
