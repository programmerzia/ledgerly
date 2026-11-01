<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Queries\Audit\VerifyAuditChain;
use Illuminate\Support\Facades\DB;

/**
 * The 13 §9 detectives as queries over the current tenant. Each returns offending rows, so an
 * empty array means the invariant holds; `problems()` runs them all.
 */
final class LedgerChecks
{
    /** @return array<string, list<mixed>> only the checks that found something */
    public static function problems(): array
    {
        $found = [
            'unbalanced_journals' => self::unbalancedJournals(),
            'projection_drift' => self::projectionDrift(),
            'numbering' => self::numberingProblems(),
            'maker_checker' => self::makerCheckerBreaches(),
            'posted_after_close' => self::postedAfterClose(),
            'trial_balance' => (int) DB::table('account_period_balances')->sum(DB::raw('debit - credit')) === 0 ? [] : ['trial balance does not net to zero'],
            'audit_chain' => self::auditChainProblems(),
        ];

        return array_filter($found, fn (array $rows) => $rows !== []);
    }

    /** @return list<mixed> */
    public static function unbalancedJournals(): array
    {
        return DB::select(<<<'SQL'
            SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id = j.id
            WHERE j.status IN ('posted', 'reversed')
            GROUP BY j.id, j.total_debit, j.total_credit
            HAVING sum(l.debit) <> sum(l.credit) OR sum(l.debit) <> j.total_debit OR sum(l.credit) <> j.total_credit OR count(*) < 2
        SQL);
    }

    /** account_period_balances = Σ posted lines per (account, period, dimension values). @return list<mixed> */
    public static function projectionDrift(): array
    {
        $dims = implode(', ', array_map(fn (int $p) => "dim{$p}_value_id", range(1, 8)));
        $on = implode(' AND ', array_map(fn (int $p) => "lines.dim{$p}_value_id IS NOT DISTINCT FROM proj.dim{$p}_value_id", range(1, 8)));

        return DB::select(<<<SQL
            WITH lines AS (
                SELECT l.account_id, j.fiscal_period_id, {$dims}, sum(l.debit) AS d, sum(l.credit) AS c
                FROM journal_lines l JOIN journals j ON j.id = l.journal_id
                WHERE j.status IN ('posted', 'reversed') GROUP BY l.account_id, j.fiscal_period_id, {$dims}
            ), proj AS (
                SELECT account_id, fiscal_period_id, {$dims}, sum(debit) AS d, sum(credit) AS c
                FROM account_period_balances GROUP BY account_id, fiscal_period_id, {$dims}
            )
            SELECT coalesce(lines.account_id, proj.account_id) AS account_id, lines.d AS line_debit, proj.d AS proj_debit, lines.c AS line_credit, proj.c AS proj_credit
            FROM lines FULL JOIN proj ON lines.account_id = proj.account_id AND lines.fiscal_period_id = proj.fiscal_period_id AND {$on}
            WHERE lines.d IS DISTINCT FROM proj.d OR lines.c IS DISTINCT FROM proj.c
        SQL);
    }

    /** Per sequence: numbers are 1..n with no gap or duplicate, and the counter sits at n+1. @return list<string> */
    public static function numberingProblems(): array
    {
        $problems = [];
        $byPrefix = [];
        foreach (DB::table('journals')->whereNotNull('number')->pluck('number') as $number) {
            preg_match('/^(.*-)(\d+)$/', (string) $number, $m);
            $byPrefix[$m[1]][] = (int) $m[2];
        }
        $counters = DB::table('sequences')->pluck('next_value', 'prefix')->all();
        foreach ($byPrefix as $prefix => $values) {
            sort($values);
            if ($values !== range(1, count($values))) {
                $problems[] = "{$prefix}: numbers are not 1..".count($values).': '.implode(',', $values);
            }
            if (($counters[$prefix] ?? null) !== count($values) + 1) {
                $problems[] = "{$prefix}: counter is ".var_export($counters[$prefix] ?? null, true).', expected '.(count($values) + 1);
            }
        }
        foreach ($counters as $prefix => $next) {
            if ($next > 1 && ! isset($byPrefix[$prefix])) {
                $problems[] = "{$prefix}: counter advanced to {$next} but no journal carries a number";
            }
        }

        return $problems;
    }

    /** @return list<mixed> */
    public static function makerCheckerBreaches(): array
    {
        return [
            ...DB::select('SELECT id, \'journal\' AS kind FROM journals WHERE approved_by IS NOT NULL AND (approved_by = created_by OR approved_by = submitted_by)'),
            ...DB::select(<<<'SQL'
                SELECT r.id, 'approval_request' AS kind FROM approval_requests r JOIN journals j ON j.id = r.document_id
                WHERE r.signed_by IS NOT NULL AND (r.signed_by = r.requested_by OR r.signed_by = j.created_by)
            SQL),
            ...DB::select('SELECT document_id, signed_by FROM approval_requests WHERE signed_by IS NOT NULL GROUP BY document_id, signed_by HAVING count(*) > 1'),
            ...DB::select(<<<'SQL'
                SELECT id, 'reopen_request' AS kind FROM period_reopen_requests
                WHERE first_approver = requested_by OR second_approver = requested_by OR first_approver = second_approver
            SQL),
        ];
    }

    /** A posted journal stamped after the close of a period that is still closed (race tests, real clock). @return list<mixed> */
    public static function postedAfterClose(): array
    {
        return DB::select(<<<'SQL'
            SELECT j.id, j.number, j.posted_at, p.closed_at FROM journals j JOIN fiscal_periods p ON p.id = j.fiscal_period_id
            WHERE p.status IN ('closed', 'locked') AND p.closed_at IS NOT NULL AND j.posted_at > p.closed_at AND j.journal_type NOT IN ('closing', 'adjustment')
        SQL);
    }

    /**
     * A posted journal inside a close window reconstructed from the audit log (frozen-clock tests,
     * where every step has its own timestamp). @return list<mixed>
     */
    public static function postedInsideClosedWindows(): array
    {
        $windows = [];
        $events = DB::table('audit_events')->whereIn('action', ['period.closed', 'period.reopened'])->orderBy('id')->get(['action', 'subject_id', 'occurred_at']);
        foreach ($events as $e) {
            if ($e->action === 'period.closed') {
                $windows[$e->subject_id][] = [$e->occurred_at, null];
            } else {
                $last = array_key_last($windows[$e->subject_id]);
                $windows[$e->subject_id][$last][1] = $e->occurred_at;
            }
        }
        $bad = [];
        foreach ($windows as $periodId => $list) {
            foreach ($list as [$from, $to]) {
                $q = DB::table('journals')->where('fiscal_period_id', $periodId)->whereIn('status', ['posted', 'reversed'])
                    ->where('posted_at', '>', $from)->whereNotIn('journal_type', ['closing', 'adjustment']);
                if ($to !== null) {
                    $q->where('posted_at', '<', $to);
                }
                foreach ($q->get(['id', 'number', 'posted_at']) as $row) {
                    $bad[] = $row;
                }
            }
        }

        return $bad;
    }

    /** @return list<string> */
    public static function auditChainProblems(): array
    {
        $report = app(VerifyAuditChain::class)();

        return $report->intact ? [] : [json_encode($report->toArray(), JSON_THROW_ON_ERROR)];
    }
}
