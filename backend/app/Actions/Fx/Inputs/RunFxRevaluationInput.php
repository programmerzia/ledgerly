<?php

declare(strict_types=1);

namespace App\Actions\Fx\Inputs;

final readonly class RunFxRevaluationInput
{
    public function __construct(
        public string $companyId,
        public string $periodId,
        /** YYYY-MM-DD inside the period; null = the period's last day (the reporting date). */
        public ?string $asOf = null,
    ) {}
}
