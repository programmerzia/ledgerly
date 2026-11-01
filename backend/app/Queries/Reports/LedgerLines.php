<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Models\Ledger\JournalLine;
use App\Support\Reports\ReportRunner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\Expression;

/**
 * Posted journal lines of one account, with their journal's date, number and source, for the general
 * ledger and the drill. A line counts when its journal is `posted` or `reversed` (the mirror of a
 * reversal is a posted journal of its own), which is exactly what the balance projection sums.
 */
final class LedgerLines
{
    public function __construct(private readonly ReportRunner $runner) {}

    /**
     * Lines ready for keyset pagination on (journal_date, id).
     *
     * @return Builder<JournalLine>
     */
    public function page(LineFilter $f): Builder
    {
        $sub = $this->base($f)->select(
            'l.*', 'j.journal_date', 'j.number as journal_number', 'j.journal_type', 'j.reference as journal_reference',
            'j.memo as journal_memo', 'j.source_type', 'j.source_id',
        );

        /** @var Builder<JournalLine> $query */
        $query = JournalLine::on((string) config('reports.connection'))->fromSub($sub, 'journal_lines');

        return $query;
    }

    /** @return array{debit: int, credit: int, count: int} totals of every line the filter selects */
    public function summary(LineFilter $f): array
    {
        $row = $this->base($f)->selectRaw('COALESCE(SUM(l.debit), 0)::bigint AS debit, COALESCE(SUM(l.credit), 0)::bigint AS credit, COUNT(*) AS n')->first();

        return ['debit' => (int) ($row->debit ?? 0), 'credit' => (int) ($row->credit ?? 0), 'count' => (int) ($row->n ?? 0)];
    }

    private function base(LineFilter $f): QueryBuilder
    {
        $q = $this->runner->db()->table('journal_lines as l')
            ->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->where('l.company_id', $f->companyId)->where('j.company_id', $f->companyId)
            ->whereIn('j.status', ['posted', 'reversed'])
            ->where('l.account_id', $f->accountId);
        if ($f->from !== null) {
            $q->where('j.journal_date', '>=', $f->from);
        }
        if ($f->to !== null) {
            $q->where('j.journal_date', '<=', $f->to);
        }
        if ($f->excludeClosing) {
            $q->where('j.journal_type', '<>', 'closing');
        }
        foreach ($f->dims as $slot => $ids) {
            if ($slot >= 1 && $slot <= 8 && $ids !== []) {
                $q->whereIn("l.dim{$slot}_value_id", $ids);
            }
        }
        if ($f->contactId !== null) {
            $q->where('l.contact_id', $f->contactId);
        }
        if ($f->contactSide !== null) {
            $this->contactSide($q, $f);
        }
        if ($f->before !== null) {
            $q->whereRaw('(j.journal_date, l.id) < (?, ?)', $f->before);
        }

        return $q;
    }

    /** Only lines of contacts whose net balance on the account, up to the end date, is on the given side. */
    private function contactSide(QueryBuilder $q, LineFilter $f): void
    {
        $sub = $this->runner->db()->table('journal_lines as x')
            ->join('journals as y', 'y.id', '=', 'x.journal_id')
            ->where('x.company_id', $f->companyId)->where('y.company_id', $f->companyId)
            ->whereIn('y.status', ['posted', 'reversed'])->where('x.account_id', $f->accountId);
        if ($f->to !== null) {
            $sub->where('y.journal_date', '<=', $f->to);
        }
        foreach ($f->dims as $slot => $ids) {
            if ($slot >= 1 && $slot <= 8 && $ids !== []) {
                $sub->whereIn("x.dim{$slot}_value_id", $ids);
            }
        }
        $sub->groupByRaw("COALESCE(x.contact_id, '00000000-0000-0000-0000-000000000000'::uuid)")
            ->havingRaw($f->contactSide === 'debit' ? 'SUM(x.debit) - SUM(x.credit) > 0' : 'SUM(x.debit) - SUM(x.credit) < 0')
            ->selectRaw("COALESCE(x.contact_id, '00000000-0000-0000-0000-000000000000'::uuid)");

        $q->whereIn(new Expression("COALESCE(l.contact_id, '00000000-0000-0000-0000-000000000000'::uuid)"), $sub);
    }
}
