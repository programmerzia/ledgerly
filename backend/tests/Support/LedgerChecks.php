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
            'trade_documents' => self::tradeProblems(),
            'settlements' => self::settlementProblems(),
            'control_accounts' => self::controlAccountProblems(),
            'bank_reconciliations' => self::bankReconciliationProblems(),
            'posted_after_close' => self::postedAfterClose(),
            'trial_balance' => (int) DB::table('account_period_balances')->sum(DB::raw('debit - credit')) === 0 ? [] : ['trial balance does not net to zero'],
            'audit_chain' => self::auditChainProblems(),
            'fixed_assets' => self::assetProblems(),
        ];

        return array_filter($found, fn (array $rows) => $rows !== []);
    }

    /**
     * Banking (2.13): every match has equal statement and book sides, and a finished reconciliation's book balance equals the sum of its
     * matched and unmatched items (opening position + matched + unmatched), is bridged to the statement balance with zero difference,
     * and every match it covers is still tied to it.
     *
     * @return list<string>
     */
    public static function bankReconciliationProblems(): array
    {
        $problems = [];
        foreach (DB::select('SELECT match_id FROM bank_match_items GROUP BY match_id HAVING coalesce(sum(amount) FILTER (WHERE statement_line_id IS NOT NULL), 0) <> coalesce(sum(amount) FILTER (WHERE journal_line_id IS NOT NULL), 0)') as $row) {
            $problems[] = "match {$row->match_id} has unequal sides";
        }
        foreach (DB::select("SELECT id FROM bank_statement_lines l WHERE (status = 'matched') <> EXISTS (SELECT 1 FROM bank_match_items i WHERE i.statement_line_id = l.id)") as $row) {
            $problems[] = "statement line {$row->id} status disagrees with its match";
        }
        foreach (DB::table('bank_reconciliations')->where('status', 'finished')->get() as $rec) {
            /** @var array{book: array{balance: int, opening_position: int, matched: int, unmatched: int, matched_after_as_of: int}, unmatched_statement: array{total: int}, statement: array{closing_balance: int}, adjusted_book_balance: int, difference: int} $r */
            $r = json_decode((string) $rec->report, true, flags: JSON_THROW_ON_ERROR);
            $book = $r['book'];
            if ($book['balance'] !== $book['opening_position'] + $book['matched'] + $book['unmatched'] || (int) $rec->book_balance !== $book['balance']) {
                $problems[] = "reconciliation {$rec->id}: book balance is not the sum of its matched and unmatched items";
            }
            if ($r['adjusted_book_balance'] !== $book['balance'] - $book['unmatched'] + $r['unmatched_statement']['total'] + $book['matched_after_as_of']
                || $r['statement']['closing_balance'] !== $r['adjusted_book_balance'] || (int) $rec->difference !== 0 || (int) $rec->statement_balance !== $r['statement']['closing_balance']) {
                $problems[] = "reconciliation {$rec->id}: statement balance does not equal the adjusted book balance";
            }
        }

        return $problems;
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
        // Journals and trade documents (invoices, credit notes, bills, debit notes) number from sequences of their own.
        $numbers = [...DB::table('journals')->whereNotNull('number')->pluck('number')->all(), ...DB::table('invoices')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('settlements')->whereNotNull('number')->pluck('number')->all(), ...DB::table('payment_runs')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('wht_certificates')->pluck('number')->all(),
            ...DB::table('purchase_requisitions')->whereNotNull('number')->pluck('number')->all(), ...DB::table('purchase_orders')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('goods_receipts')->pluck('number')->all(),
            ...DB::table('fund_transfers')->whereNotNull('number')->pluck('number')->all(), ...DB::table('write_offs')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('provision_runs')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('fixed_assets')->pluck('number')->all(), ...DB::table('depreciation_runs')->whereNotNull('number')->pluck('number')->all(),
            ...DB::table('asset_transactions')->whereNotNull('number')->pluck('number')->all()];
        foreach ($numbers as $number) {
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
                $problems[] = "{$prefix}: counter advanced to {$next} but no document carries a number";
            }
        }

        return $problems;
    }

    /**
     * Trade documents (13 §9): a posted document has a posted journal that names it as its source, whose control
     * line carries exactly what the document says is owed (sales: Dr/Cr AR total; purchases: Cr/Dr AP total less
     * withheld tax), and nobody approved what they made or submitted. @return list<mixed>
     */
    public static function tradeProblems(): array
    {
        return [
            ...DB::select(<<<'SQL'
                SELECT i.id, i.number, 'journal link' AS problem FROM invoices i
                LEFT JOIN journals j ON j.id = i.journal_id
                WHERE i.status IN ('posted', 'reversed') AND (j.id IS NULL OR j.status NOT IN ('posted', 'reversed') OR j.source_id <> i.id OR j.source_type <> i.kind::text)
            SQL),
            ...DB::select(<<<'SQL'
                SELECT i.id, i.number, 'control line' AS problem FROM invoices i
                JOIN journal_lines l ON l.journal_id = i.journal_id AND l.line_no = 1
                WHERE i.status IN ('posted', 'reversed') AND NOT (
                    (i.kind = 'sales_invoice' AND l.debit = i.total AND l.credit = 0) OR (i.kind = 'credit_note' AND l.credit = i.total AND l.debit = 0)
                    OR (i.kind = 'purchase_bill' AND l.credit = i.total - i.wht_amount AND l.debit = 0) OR (i.kind = 'debit_note' AND l.debit = i.total - i.wht_amount AND l.credit = 0))
            SQL),
            ...DB::select("SELECT id, number, 'maker-checker' AS problem FROM invoices WHERE approved_by IS NOT NULL AND (approved_by = created_by OR approved_by = submitted_by)"),
            ...DB::select("SELECT id, number, 'settled beyond total' AS problem FROM invoices WHERE settled_fc > total_fc OR settled > total"),
        ];
    }

    /**
     * Settlements (13 §9, D4, D9): a posted settlement has a journal that names it, whose cash line is its base amount; what each
     * document and each credit says is settled equals the allocations and applications behind it, nothing was over-allocated.
     *
     * @return list<mixed>
     */
    public static function settlementProblems(): array
    {
        return [
            ...DB::select(<<<'SQL'
                SELECT s.id, s.number, 'journal link or cash line' AS problem FROM settlements s
                LEFT JOIN journals j ON j.id = s.journal_id
                WHERE s.status IN ('posted', 'reversed') AND (j.id IS NULL OR j.source_id <> s.id OR j.source_type <> 'settlement'
                  OR NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = j.id AND l.account_id = s.cash_account_id AND GREATEST(l.debit, l.credit) = s.amount))
            SQL),
            // settled = allocations of posted settlements + active applications to it + active applications of it as a note
            ...DB::select(<<<'SQL'
                SELECT i.id, i.number, 'settled differs from allocations' AS problem FROM invoices i
                WHERE i.status IN ('posted', 'reversed') AND (i.settled_fc, i.settled) IS DISTINCT FROM (
                  (SELECT COALESCE(SUM(a.amount_fc), 0) FROM settlement_allocations a JOIN settlements s ON s.id = a.settlement_id WHERE a.invoice_id = i.id AND s.status = 'posted')
                  + (SELECT COALESCE(SUM(c.amount_fc), 0) FROM credit_applications c WHERE c.invoice_id = i.id AND c.reversed_at IS NULL)
                  + (SELECT COALESCE(SUM(c.amount_fc), 0) FROM credit_applications c WHERE c.note_id = i.id AND c.reversed_at IS NULL)
                  + (SELECT COALESCE(SUM(w.amount_fc), 0) FROM write_offs w WHERE w.invoice_id = i.id AND w.status = 'posted'),
                  (SELECT COALESCE(SUM(a.amount), 0) FROM settlement_allocations a JOIN settlements s ON s.id = a.settlement_id WHERE a.invoice_id = i.id AND s.status = 'posted')
                  + (SELECT COALESCE(SUM(c.amount), 0) FROM credit_applications c WHERE c.invoice_id = i.id AND c.reversed_at IS NULL)
                  + (SELECT COALESCE(SUM(c.source_amount), 0) FROM credit_applications c WHERE c.note_id = i.id AND c.reversed_at IS NULL)
                  + (SELECT COALESCE(SUM(w.amount), 0) FROM write_offs w WHERE w.invoice_id = i.id AND w.status = 'posted'))
            SQL),
            ...DB::select(<<<'SQL'
                SELECT s.id, s.number, 'unallocated differs from allocations' AS problem FROM settlements s
                WHERE s.status = 'posted' AND s.unallocated_fc <> (
                  s.amount_fc - (SELECT COALESCE(SUM(a.amount_fc), 0) FROM settlement_allocations a WHERE a.settlement_id = s.id)
                    - (SELECT COALESCE(SUM(c.amount_fc), 0) FROM credit_applications c WHERE c.settlement_id = s.id AND c.reversed_at IS NULL)
                    - (SELECT COALESCE(SUM(a.amount_fc), 0) FROM settlement_allocations a JOIN settlements r ON r.id = a.settlement_id WHERE a.source_settlement_id = s.id AND r.status = 'posted'))
            SQL),
        ];
    }

    /**
     * The sub-ledger ties to the control accounts (D9): per contact, the AR or AP control balance equals the open documents less the
     * credits (open credit notes, and credit on account of receipts and payments), so credit balances are visible, not netted away.
     *
     * @return list<mixed>
     */
    public static function controlAccountProblems(): array
    {
        return DB::select(<<<'SQL'
            WITH bal AS (
              SELECT l.contact_id, a.control_type::text AS ct, SUM(l.debit - l.credit) AS d
              FROM journal_lines l JOIN accounts a ON a.id = l.account_id
              WHERE a.control_type IN ('ar', 'ap') AND l.contact_id IS NOT NULL GROUP BY 1, 2
            ), docs AS (
              SELECT contact_id, CASE WHEN kind IN ('sales_invoice', 'credit_note') THEN 'ar' ELSE 'ap' END AS ct,
                SUM(CASE kind WHEN 'sales_invoice' THEN 1 WHEN 'credit_note' THEN -1 WHEN 'purchase_bill' THEN -1 ELSE 1 END * (total - wht_amount - settled)) AS d
              FROM invoices WHERE status = 'posted' GROUP BY 1, 2
            ), cr AS (
              SELECT contact_id, CASE WHEN kind IN ('receipt', 'refund') THEN 'ar' ELSE 'ap' END AS ct,
                SUM(CASE kind WHEN 'receipt' THEN -1 WHEN 'payment' THEN 1 WHEN 'refund' THEN 1 ELSE -1 END * unallocated) AS d
              FROM settlements WHERE status = 'posted' GROUP BY 1, 2
            ), keys AS (SELECT contact_id, ct FROM docs UNION SELECT contact_id, ct FROM cr)
            SELECT k.contact_id, k.ct, COALESCE(bal.d, 0) AS ledger, COALESCE(docs.d, 0) + COALESCE(cr.d, 0) AS subledger
            FROM keys k
            LEFT JOIN bal ON bal.contact_id = k.contact_id AND bal.ct = k.ct
            LEFT JOIN docs ON docs.contact_id = k.contact_id AND docs.ct = k.ct
            LEFT JOIN cr ON cr.contact_id = k.contact_id AND cr.ct = k.ct
            WHERE COALESCE(bal.d, 0) <> COALESCE(docs.d, 0) + COALESCE(cr.d, 0)
        SQL);
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

    /**
     * Fixed assets (13 §23 D15.1): every register figure equals the sum of its movements, nothing is depreciated below its residual
     * value, and every movement that names a journal names a posted or reversed one of the same company.
     *
     * @return list<string>
     */
    public static function assetProblems(): array
    {
        $problems = [];
        $sums = DB::select(
            'SELECT a.id, a.number, a.cost, a.accumulated_depreciation AS dep, a.accumulated_impairment AS imp, a.revaluation_reserve AS reserve, a.revaluation_deficit AS deficit,
                    a.months_charged AS months, a.units_used AS units, a.residual, a.status,
                    COALESCE(SUM(m.cost_delta), 0) AS m_cost, COALESCE(SUM(m.depreciation_delta), 0) AS m_dep, COALESCE(SUM(m.impairment_delta), 0) AS m_imp,
                    COALESCE(SUM(m.reserve_delta), 0) AS m_reserve, COALESCE(SUM(m.deficit_delta), 0) AS m_deficit, COALESCE(SUM(m.months_delta), 0) AS m_months, COALESCE(SUM(m.units_delta), 0) AS m_units
               FROM fixed_assets a LEFT JOIN asset_movements m ON m.asset_id = a.id GROUP BY a.id',
        );
        foreach ($sums as $r) {
            foreach (['cost' => 'm_cost', 'dep' => 'm_dep', 'imp' => 'm_imp', 'reserve' => 'm_reserve', 'deficit' => 'm_deficit', 'months' => 'm_months', 'units' => 'm_units'] as $figure => $sum) {
                if ((int) $r->{$figure} !== (int) $r->{$sum}) {
                    $problems[] = "asset {$r->number}: {$figure} is {$r->{$figure}} but its movements add up to {$r->{$sum}}";
                }
            }
            if ($r->status === 'active' && (int) $r->cost - (int) $r->dep - (int) $r->imp < (int) $r->residual) {
                $problems[] = "asset {$r->number}: carrying amount is below its residual value";
            }
        }
        foreach (DB::select("SELECT m.id FROM asset_movements m LEFT JOIN journals j ON j.id = m.journal_id WHERE m.journal_id IS NOT NULL AND (j.id IS NULL OR j.company_id <> m.company_id OR j.status NOT IN ('posted', 'reversed'))") as $row) {
            $problems[] = "asset movement {$row->id} names a journal that is not posted";
        }

        return $problems;
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
