<?php

declare(strict_types=1);

namespace App\Services\Fiscal;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use Illuminate\Database\Eloquent\Builder;

/** APPROVALS: nothing dated in the period is still waiting for an approver. */
final class PendingApprovalsCheck implements PeriodCloseCheck
{
    public function code(): string
    {
        return 'APPROVALS';
    }

    public function run(FiscalPeriod $period): CheckOutcome
    {
        $ids = self::inPeriod($period)->where('status', 'pending_approval')->pluck('id')->all();

        return new CheckOutcome($this->code(), $ids === [], $ids === [] ? 'Nothing is waiting for approval.' : count($ids).' journal(s) are waiting for approval.', ['journal_ids' => $ids]);
    }

    /**
     * Journals that belong to the period: explicitly assigned (adjustment period), or dated inside a
     * regular period and not assigned elsewhere.
     *
     * @return Builder<Journal>
     */
    public static function inPeriod(FiscalPeriod $period): Builder
    {
        $query = Journal::query()->where('company_id', $period->company_id);
        if ($period->kind === 'adjustment') {
            return $query->where('fiscal_period_id', $period->id);
        }

        return $query->where(fn (Builder $q) => $q->where('fiscal_period_id', $period->id)->orWhere(fn (Builder $d) => $d
            ->whereNull('fiscal_period_id')
            ->whereNotIn('journal_type', ['closing', 'adjustment'])
            ->whereBetween('journal_date', [$period->starts_on->format('Y-m-d'), $period->ends_on->format('Y-m-d')])));
    }
}
