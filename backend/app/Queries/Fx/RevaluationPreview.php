<?php

declare(strict_types=1);

namespace App\Queries\Fx;

use App\Domain\Fx\RevaluationPlan;

/** The result of PreviewFxRevaluation. `blockers` are stable codes: fx_rate_missing, period_closed, fx_revaluation_exists, fx_period_invalid. */
final readonly class RevaluationPreview
{
    /** @param list<string> $blockers */
    public function __construct(
        public string $periodId,
        public RevaluationPlan $plan,
        public ?string $existingRevaluationId,
        public array $blockers,
    ) {}

    public function canRun(): bool
    {
        return $this->blockers === [];
    }
}
