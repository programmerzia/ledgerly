<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Support\Reports\Dates;
use App\Support\Reports\ReportRunner;
use InvalidArgumentException;

/**
 * Debit and credit totals per account over a date range, read from `account_period_balances` for every
 * fiscal period that lies wholly inside the range and from posted `journal_lines` for the rest (the
 * partial period at either end, and the adjustment period when closing journals must stay out).
 *
 * Both sources count the same thing: posted journals, including `reversed` originals and their mirrors.
 * The two never overlap: the lines branch skips the periods the projection covered (the date ranges are
 * the complement of the covered regular periods, and adjustment-period journals are read by period id).
 *
 * `$excludeClosing` drops `closing` journals and their reversals (D7). Adjustment periods then come
 * from lines, since the projection cannot tell a closing journal from an audit adjustment.
 */
final class LedgerBalances
{
    private const string BEGINNING = '0001-01-01';

    public function __construct(private readonly ReportRunner $runner, private readonly PeriodCalendar $calendar) {}

    /**
     * @param  array<int, list<string>>  $dims  dimension slot (1..8) → accepted value ids
     * @param  int|null  $groupSlot  also split the totals by this dimension slot
     * @param  bool  $fxOnly  only FX revaluation journals and their reversals (lines only)
     * @param  bool  $assetRevaluationOnly  only asset revaluation journals (source `asset_revaluation`) and their reversals (lines only)
     * @param  list<string>|null  $accountIds
     * @return list<BalanceRow>
     */
    public function totals(
        string $companyId, ?string $from, string $to, bool $excludeClosing,
        array $dims = [], ?int $groupSlot = null, bool $fxOnly = false, ?array $accountIds = null, bool $assetRevaluationOnly = false,
    ): array {
        if ($from !== null && $from > $to) {
            return [];
        }
        if ($accountIds === []) {
            return [];
        }
        if ($groupSlot !== null && ($groupSlot < 1 || $groupSlot > 8)) {
            throw new InvalidArgumentException('Dimension slot out of range.');
        }

        [$projectionIds, $dateRanges, $adjustmentIds] = $this->plan($companyId, $from, $to, $excludeClosing, $fxOnly || $assetRevaluationOnly);
        $group = $groupSlot === null ? 'NULL::uuid' : "%s.dim{$groupSlot}_value_id";

        $parts = [];
        $bindings = [];
        if ($projectionIds !== []) {
            $parts[] = 'SELECT b.account_id, '.sprintf($group, 'b').' AS grp, b.debit, b.credit FROM account_period_balances b WHERE b.company_id = ? AND b.fiscal_period_id IN ('.$this->marks($projectionIds).')'
                .($f = $this->filters('b', $dims, $accountIds))[0];
            array_push($bindings, $companyId, ...$projectionIds, ...$f[1]);
        }
        $lines = 'SELECT l.account_id, '.sprintf($group, 'l').' AS grp, l.debit, l.credit FROM journal_lines l JOIN journals j ON j.id = l.journal_id'
            ." WHERE l.company_id = ? AND j.company_id = ? AND j.status IN ('posted', 'reversed')";
        $fx = $fxOnly ? ' AND (j.journal_type = \'fx\' OR j.reversal_of_id IN (SELECT f.id FROM journals f WHERE f.company_id = ? AND f.journal_type = \'fx\'))' : '';
        if ($assetRevaluationOnly) {
            // A reversal copies its original's source type.
            $fx = " AND j.source_type = 'asset_revaluation'";
        }
        if ($dateRanges !== []) {
            $ranges = implode(' OR ', array_fill(0, count($dateRanges), '(j.journal_date BETWEEN ? AND ?)'));
            $parts[] = $lines." AND j.journal_type NOT IN ('closing', 'adjustment') AND ({$ranges})".$fx.($f = $this->filters('l', $dims, $accountIds))[0];
            array_push($bindings, $companyId, $companyId);
            foreach ($dateRanges as [$a, $b]) {
                array_push($bindings, $a, $b);
            }
            if ($fxOnly) {
                $bindings[] = $companyId;
            }
            array_push($bindings, ...$f[1]);
        }
        if ($adjustmentIds !== []) {
            $parts[] = $lines." AND j.journal_type = 'adjustment' AND j.fiscal_period_id IN (".$this->marks($adjustmentIds).')'
                .($f = $this->filters('l', $dims, $accountIds))[0];
            array_push($bindings, $companyId, $companyId, ...$adjustmentIds, ...$f[1]);
        }
        if ($parts === []) {
            return [];
        }

        $rows = $this->runner->db()->select(
            'SELECT account_id, grp, SUM(debit)::bigint AS debit, SUM(credit)::bigint AS credit FROM ('.implode(' UNION ALL ', $parts).') u GROUP BY account_id, grp',
            $bindings,
        );

        $out = [];
        foreach ($rows as $r) {
            $out[] = new BalanceRow((string) $r->account_id, $r->grp === null ? null : (string) $r->grp, (int) $r->debit, (int) $r->credit);
        }

        return $out;
    }

    /**
     * Net position per contact on the given (control) accounts up to a date, from posted lines. Lines
     * without a contact come back under a null contact id.
     *
     * @param  list<string>  $accountIds
     * @param  array<int, list<string>>  $dims
     * @return list<array{account_id: string, contact_id: string|null, debit: int, credit: int}>
     */
    public function contactTotals(string $companyId, string $to, array $accountIds, array $dims = []): array
    {
        if ($accountIds === []) {
            return [];
        }
        [$sql, $filterBindings] = $this->filters('l', $dims, $accountIds);
        $rows = $this->runner->db()->select(
            'SELECT l.account_id, l.contact_id, SUM(l.debit)::bigint AS debit, SUM(l.credit)::bigint AS credit FROM journal_lines l JOIN journals j ON j.id = l.journal_id'
            ." WHERE l.company_id = ? AND j.company_id = ? AND j.status IN ('posted', 'reversed') AND j.journal_date <= ?".$sql
            .' GROUP BY l.account_id, l.contact_id',
            [$companyId, $companyId, $to, ...$filterBindings],
        );

        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'account_id' => (string) $r->account_id, 'contact_id' => $r->contact_id === null ? null : (string) $r->contact_id,
                'debit' => (int) $r->debit, 'credit' => (int) $r->credit,
            ];
        }

        return $out;
    }

    /**
     * Which source answers which part of the range.
     *
     * @return array{0: list<string>, 1: list<array{string, string}>, 2: list<string>} projection period ids, date ranges for lines, adjustment period ids for lines
     */
    private function plan(string $companyId, ?string $from, string $to, bool $excludeClosing, bool $fxOnly): array
    {
        if ($fxOnly) {
            return [[], [[$from ?? self::BEGINNING, $to]], []];
        }

        $projection = [];
        $adjustment = [];
        $regular = [];
        foreach ($this->calendar->periods($companyId) as $p) {
            if (($from !== null && $p->startsOn < $from) || $p->endsOn > $to) {
                continue;
            }
            if ($p->isRegular()) {
                $projection[] = $p->id;
                $regular[] = $p;
            } elseif ($excludeClosing) {
                $adjustment[] = $p->id;
            } else {
                $projection[] = $p->id;
            }
        }

        $ranges = [];
        $cursor = $from ?? self::BEGINNING;
        foreach ($regular as $p) {   // ordered by start date
            if ($p->startsOn > $cursor) {
                $ranges[] = [$cursor, Dates::before($p->startsOn)];
            }
            $cursor = max($cursor, Dates::after($p->endsOn));
        }
        if ($cursor <= $to) {
            $ranges[] = [$cursor, $to];
        }

        return [$projection, $ranges, $adjustment];
    }

    /**
     * @param  array<int, list<string>>  $dims
     * @param  list<string>|null  $accountIds
     * @return array{string, list<string>} SQL to append and its bindings
     */
    private function filters(string $alias, array $dims, ?array $accountIds): array
    {
        $bindings = [];
        $sql = '';
        foreach ($dims as $slot => $ids) {
            if ($slot < 1 || $slot > 8 || $ids === []) {
                continue;
            }
            $sql .= " AND {$alias}.dim{$slot}_value_id IN (".$this->marks($ids).')';
            array_push($bindings, ...$ids);
        }
        if ($accountIds !== null) {
            $sql .= " AND {$alias}.account_id IN (".$this->marks($accountIds).')';
            array_push($bindings, ...$accountIds);
        }

        return [$sql, $bindings];
    }

    /** @param list<string> $values */
    private function marks(array $values): string
    {
        return implode(', ', array_fill(0, count($values), '?'));
    }
}
