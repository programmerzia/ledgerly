<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/** Where one balance sheet account's movement lands in the cash flow statement, and why. */
final readonly class CashFlowClass
{
    public function __construct(
        public CashFlowActivity $activity,
        /** A non-cash adjustment of operating profit (depreciation), listed apart from working capital. */
        public bool $nonCash,
        /** True when the class is IAS 7's default for an account the mapping could not decide. */
        public bool $assumed,
        public string $reason,
    ) {}
}
