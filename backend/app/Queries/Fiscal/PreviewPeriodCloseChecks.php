<?php

declare(strict_types=1);

namespace App\Queries\Fiscal;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;
use Illuminate\Contracts\Container\Container;

/**
 * Runs the registered close checks (config/period_close.php) without locking or storing anything: what
 * the close dialog shows before the person decides which failures to waive. `ClosePeriod` runs the same
 * checks again under the period lock, so this answer can be stale but never wrong about a close.
 */
final class PreviewPeriodCloseChecks
{
    public function __construct(private readonly Container $container) {}

    /** @return list<CheckOutcome> */
    public function __invoke(FiscalPeriod $period): array
    {
        /** @var list<class-string<PeriodCloseCheck>> $classes */
        $classes = (array) config('period_close.checks', []);

        return array_map(fn (string $class): CheckOutcome => $this->container->make($class)->run($period), $classes);
    }
}
