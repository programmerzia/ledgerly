<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Journal;
use Illuminate\Database\Eloquent\Builder;

/** The company's journals, filtered; the caller paginates. Summaries only: lines come with the detail. */
final class ListJournals
{
    /** @return Builder<Journal> */
    public function __invoke(string $companyId, JournalFilter $filter): Builder
    {
        $query = Journal::query()->where('company_id', $companyId);
        if ($filter->status !== null) {
            $query->where('status', $filter->status);
        }
        if ($filter->type !== null) {
            $query->where('journal_type', $filter->type);
        }
        if ($filter->from !== null) {
            $query->where('journal_date', '>=', $filter->from);
        }
        if ($filter->to !== null) {
            $query->where('journal_date', '<=', $filter->to);
        }
        if ($filter->periodId !== null) {
            $query->where('fiscal_period_id', $filter->periodId);
        }
        if ($filter->search !== null && trim($filter->search) !== '') {
            $like = '%'.addcslashes(trim($filter->search), '\\%_').'%';
            $query->where(fn (Builder $q) => $q->where('number', 'ilike', $like)->orWhere('reference', 'ilike', $like));
        }

        return $query;
    }
}
