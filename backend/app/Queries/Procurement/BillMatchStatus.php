<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Shared\Violation;
use App\Models\Procurement\BillMatchResult;
use App\Models\Trade\Invoice;
use App\Services\Procurement\BillMatchEvaluator;

/** How a bill stands against its purchase orders right now, and what the last submit found. Reads only. */
final class BillMatchStatus
{
    public function __construct(private readonly BillMatchEvaluator $evaluator) {}

    public function of(Invoice $bill): BillMatchView
    {
        $bill->load('lines');
        $found = $this->evaluator->evaluate($bill);
        $last = BillMatchResult::query()->where('invoice_id', $bill->id)->orderByDesc('created_at')->orderByDesc('id')->first();

        return new BillMatchView(
            $found->applies,
            array_map(fn (Violation $v) => $v->toArray(), $found->refusals),
            array_map(fn (Violation $v) => $v->toArray(), $found->mismatches),
            $found->lines,
            $bill->currency,
            $last,
        );
    }
}
