<?php

declare(strict_types=1);

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Queries\Reports\LedgerBalances;
use App\Queries\Reports\LedgerLines;
use App\Queries\Reports\LineFilter;
use App\Queries\Reports\RunReport;
use App\Support\Reports\Dates;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;
use Tests\Support\ReportScenario;

/*
 * Seeded random ledgers (with dimensions, contacts on both sides of AR and AP, and reversals): whatever the
 * mix, the reports reconcile with each other and with the raw journal lines, before and after the year-end
 * close. Failures print the seed; rerun with `--filter` on the dataset key.
 */

/** Net (debit - credit) per account over a date range, straight from the lines. @return array<string, int> */
function bruteForce(?string $from, string $to, bool $excludeClosing): array
{
    $rows = DB::select(
        "SELECT l.account_id, SUM(l.debit) - SUM(l.credit) AS net FROM journal_lines l JOIN journals j ON j.id = l.journal_id
         WHERE j.status IN ('posted', 'reversed') AND j.journal_date <= ? AND (?::date IS NULL OR j.journal_date >= ?::date)
           AND (NOT ? OR j.journal_type <> 'closing') GROUP BY l.account_id",
        [$to, $from, $from, $excludeClosing ? 1 : 0],
    );

    return collect($rows)->mapWithKeys(fn ($r) => [$r->account_id => (int) $r->net])->filter()->all();
}

function randomLedger(ReportScenario $s, int $journals): void
{
    $fund = (string) Str::uuid7();
    $values = [(string) Str::uuid7(), (string) Str::uuid7()];
    DB::table('dimensions')->insert(['id' => $fund, 'tenant_id' => $s->f->tenantId, 'company_id' => $s->f->companyId, 'code' => 'FUND', 'name' => 'Fund', 'position' => 1]);
    foreach ($values as $i => $id) {
        DB::table('dimension_values')->insert(['id' => $id, 'tenant_id' => $s->f->tenantId, 'company_id' => $s->f->companyId, 'dimension_id' => $fund, 'code' => "F{$i}", 'name' => "Fund {$i}"]);
    }
    $customers = ['Cust 1', 'Cust 2', 'Cust 3'];
    $suppliers = ['Supp 1', 'Supp 2'];
    $plain = ['1000', '1300', '1500', '1510', '2200', '3100', '4000', '4800', '5000', '5100', '6500', '6800'];
    $plAndEquity = ['3100', '4000', '4800', '5000', '5100', '6500', '6800'];
    $posted = [];

    for ($i = 0; $i < $journals; $i++) {
        $date = sprintf('2026-%02d-%02d', mt_rand(1, 10), mt_rand(1, 28));
        $amount = mt_rand(1, 400_000);
        $dims = fn (string $code) => in_array($code, $plAndEquity, true) && mt_rand(0, 2) === 0 ? [1 => $values[mt_rand(0, 1)]] : [];
        $kind = mt_rand(1, 6);
        if ($kind === 1) {                       // customer invoice or credit
            $c = $customers[mt_rand(0, 2)];
            $lines = [['1100', $amount, 0, $c], ['4000', 0, $amount, $dims('4000')]];
        } elseif ($kind === 2) {                 // receipt, possibly more than owed
            $c = $customers[mt_rand(0, 2)];
            $lines = [['1000', $amount, 0], ['1100', 0, $amount, $c]];
        } elseif ($kind === 3) {                 // supplier bill
            $x = $suppliers[mt_rand(0, 1)];
            $lines = [['5100', $amount, 0, $dims('5100')], ['2000', 0, $amount, $x]];
        } elseif ($kind === 4) {                 // payment, possibly an advance
            $x = $suppliers[mt_rand(0, 1)];
            $lines = [['2000', $amount, 0, $x], ['1000', 0, $amount]];
        } else {                                 // anything between two plain accounts, sometimes split in three
            [$dr, $cr] = [$plain[mt_rand(0, 11)], $plain[mt_rand(0, 11)]];
            if ($dr === $cr) {
                continue;
            }
            $part = mt_rand(0, $amount);
            $lines = $part > 0 && $part < $amount
                ? [[$dr, $part, 0, $dims($dr)], [$dr, $amount - $part, 0, $dims($dr)], [$cr, 0, $amount, $dims($cr)]]
                : [[$dr, $amount, 0, $dims($dr)], [$cr, 0, $amount, $dims($cr)]];
        }
        $posted[] = $s->post($date, $lines);

        if (mt_rand(0, 9) === 0) {               // reverse a random earlier journal
            $victim = $posted[mt_rand(0, count($posted) - 1)];
            if ($victim->fresh()?->status->value === 'posted') {
                app(ReverseJournal::class)->handle($s->signer(), new ReverseJournalInput($victim->id));
            }
        }
    }
}

function randomRange(): array
{
    $m = mt_rand(1, 10);
    $d = mt_rand(1, 28);
    $e = mt_rand($m, 10);

    return [sprintf('2026-%02d-%02d', $m, $d), sprintf('2026-%02d-%02d', $e, mt_rand($e === $m ? $d : 1, 28))];
}

it('reconciles trial balance, balance sheet, profit and loss and cash flow on random ledgers', function (int $seed): void {
    mt_srand($seed);
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment', 'journals.reverse');
    $s = ReportScenario::create();
    randomLedger($s, 45);
    expect(LedgerChecks::problems())->toBe([]);

    $company = $s->company();
    $run = fn (string $r, array $in) => app(RunReport::class)($r, $company, $in);
    $balances = app(LedgerBalances::class);
    $lines = app(LedgerLines::class);
    $note = "seed {$seed}";

    // 1. The projection and the raw lines agree on any range, with and without the closing journals.
    for ($i = 0; $i < 12; $i++) {
        [$from, $to] = randomRange();
        foreach ([[null, $to], [$from, $to], [$s->f->period($from)->starts_on->format('Y-m-d'), $s->f->period($to)->ends_on->format('Y-m-d')]] as [$a, $b]) {
            $got = [];
            foreach ($balances->totals($company->id, $a, $b, true) as $row) {
                $got[$row->accountId] = ($got[$row->accountId] ?? 0) + $row->debit - $row->credit;
            }
            expect(array_filter($got))->toEqual(bruteForce($a, $b, true), "totals {$a}..{$b} {$note}");
        }
    }

    // 2. Trial balance and balance sheet balance on every date, whether month end or not.
    $dates = ['2026-01-31', '2026-04-30', '2026-10-31', '2026-12-31', ...array_map(fn () => randomRange()[1], range(1, 6))];
    foreach ($dates as $asOf) {
        $tb = $run('trial-balance', ['as_of' => $asOf]);
        $bs = $run('balance-sheet', ['as_of' => $asOf]);
        expect($tb['totals']['debit']['amount'])->toBe($tb['totals']['credit']['amount'], "TB {$asOf} {$note}")
            ->and($bs['balanced'])->toBeTrue("BS {$asOf} {$note} diff ".$bs['difference']['amount'])
            ->and($bs['assets']['total']['amount']['amount'])->toBe($bs['liabilities']['total']['amount']['amount'] + $bs['equity']['total']['amount']['amount']);

        // D9: no receivable or payable control line holds a balance of the wrong side.
        foreach ($bs['assets']['lines'] as $l) {
            if (isset($l['account']) && ! isset($l['gross'])) {
                $isAr = $s->f->account('1100') === $l['account']['id'];
                if ($isAr) {
                    expect($l['amount']['amount'])->toBeGreaterThanOrEqual(0, "AR kept {$asOf} {$note}");
                }
            }
        }
        foreach ($bs['liabilities']['lines'] as $l) {
            if (($l['account']['id'] ?? null) === $s->f->account('2000') && ! isset($l['gross'])) {
                expect($l['amount']['amount'])->toBeGreaterThanOrEqual(0, "AP kept {$asOf} {$note}");
            }
        }
    }

    // 3. Profit and loss net equals the movement of the balance sheet's result, within the (unclosed) year.
    foreach ([['2026-01-31', '2026-03-31'], ['2026-03-31', '2026-10-31'], ['2026-02-28', '2026-12-31']] as [$from, $to]) {
        $net = fn (string $a, string $b) => $run('profit-and-loss', ['from' => Dates::after($a), 'to' => $b])['subtotals']['net_profit']['amount']['amount'];
        $result = fn (string $d) => collect($run('balance-sheet', ['as_of' => $d])['equity']['lines'])->filter(fn ($l) => str_contains($l['key'], '_result:'))->sum('amount.amount');
        expect($net($from, $to))->toBe($result($to) - $result($from), "P&L vs BS {$from}..{$to} {$note}");
    }

    // 4. Cash flow reconciles to the change in cash, in months, year to date and custom ranges, and the cash matches the TB.
    foreach ([...array_map(fn ($m) => ['period_id' => $s->periodId(sprintf('2026-%02d-15', $m))], range(1, 10)), ['period_id' => $s->periodId('2026-06-15'), 'basis' => 'ytd'], ['from' => '2026-02-11', 'to' => '2026-08-19']] as $in) {
        $cf = $run('cash-flow', $in);
        $tb = $run('trial-balance', ['as_of' => $cf['to']]);
        $cash = collect($tb['rows'])->filter(fn ($r) => $r['account']['code'] === '1000')->sum(fn ($r) => $r['debit']['amount'] - $r['credit']['amount']);
        expect($cf['reconciles'])->toBeTrue('CF '.json_encode($in).' unexplained '.$cf['unexplained']['amount'].' '.$note)
            ->and($cf['closing_cash']['amount'])->toBe($cash)
            ->and($cf['closing_cash']['amount'] - $cf['opening_cash']['amount'])->toBe($cf['net_change_in_cash']['amount'])
            ->and($cf['operating']['total']['amount'] + $cf['investing']['total']['amount'] + $cf['financing']['total']['amount'] + $cf['fx_effect_on_cash']['amount'])->toBe($cf['net_change_in_cash']['amount']);
    }

    // 5. Every drill sums to its cell.
    $tb = $run('trial-balance', ['as_of' => '2026-07-17', 'hide_zero' => true]);
    foreach ($tb['rows'] as $r) {
        $sum = $lines->summary(new LineFilter($company->id, $r['account']['id'], null, '2026-07-17'));
        expect($sum['debit'] - $sum['credit'])->toBe($r['debit']['amount'] - $r['credit']['amount'], "TB drill {$r['account']['code']} {$note}");
    }
    $pl = $run('profit-and-loss', ['from' => '2026-02-03', 'to' => '2026-09-21', 'hide_zero' => true]);
    foreach ($pl['sections'] as $section) {
        foreach ($section['lines'] as $l) {
            $sum = $lines->summary(new LineFilter($company->id, $l['account']['id'], '2026-02-03', '2026-09-21', true));
            $income = in_array($section['key'], ['operating_revenue', 'other_income'], true);
            expect($income ? $sum['credit'] - $sum['debit'] : $sum['debit'] - $sum['credit'])->toBe($l['amount']['amount'], "P&L drill {$l['account']['code']} {$note}");
        }
    }

    // 5b. A breakdown by the FUND dimension adds up to the plain report, for any range and date (3c.19).
    $fundId = (string) DB::table('dimensions')->where('company_id', $s->f->companyId)->where('code', 'FUND')->value('id');
    $sum = fn (array $cells): int => array_sum(array_column($cells, 'amount'));
    for ($i = 0; $i < 4; $i++) {
        [$from, $to] = randomRange();
        $plainPl = $run('profit-and-loss', ['from' => $from, 'to' => $to]);
        $splitPl = $run('profit-and-loss', ['from' => $from, 'to' => $to, 'breakdown' => $fundId]);
        $plainTb = $run('trial-balance', ['as_of' => $to]);
        $splitTb = $run('trial-balance', ['as_of' => $to, 'breakdown' => $fundId]);
        foreach (['gross_profit', 'operating_profit', 'net_profit'] as $k) {
            expect($sum($splitPl['subtotals'][$k]['by_dimension']))->toBe($plainPl['subtotals'][$k]['amount']['amount'], "P&L {$k} breakdown {$from}..{$to} {$note}");
        }
        foreach ($splitPl['sections'] as $si => $section) {
            foreach ($section['lines'] as $li => $l) {
                expect($sum($l['by_dimension']))->toBe($plainPl['sections'][$si]['lines'][$li]['amount']['amount'], "P&L line breakdown {$note}");
            }
        }
        foreach ($splitTb['rows'] as $ri => $r) {
            expect($sum($r['by_dimension']))->toBe($plainTb['rows'][$ri]['debit']['amount'] - $plainTb['rows'][$ri]['credit']['amount'], "TB breakdown {$r['account']['code']} {$to} {$note}");
        }
        expect(count($splitTb['rows']))->toBe(count($plainTb['rows']));
    }

    // 6. The year-end close changes neither profit and loss nor the equity total; retained earnings gains the result.
    $before = [
        'pl' => $run('profit-and-loss', ['period_id' => $s->periodId('2026-12-15'), 'basis' => 'ytd'])['subtotals'],
        'part' => $run('profit-and-loss', ['from' => '2026-02-03', 'to' => '2026-09-21'])['subtotals'],
        'equity' => $run('balance-sheet', ['as_of' => '2026-12-31'])['equity']['total']['amount']['amount'],
    ];
    $s->closeYear();
    $after = [
        'pl' => $run('profit-and-loss', ['period_id' => $s->periodId('2026-12-15'), 'basis' => 'ytd'])['subtotals'],
        'part' => $run('profit-and-loss', ['from' => '2026-02-03', 'to' => '2026-09-21'])['subtotals'],
        'equity' => $run('balance-sheet', ['as_of' => '2026-12-31'])['equity']['total']['amount']['amount'],
    ];
    expect($after)->toEqual($before, "close {$note}");

    $bs = $run('balance-sheet', ['as_of' => '2026-12-31']);
    $retained = collect($bs['equity']['lines'])->filter(fn ($l) => ($l['account']['code'] ?? null) === '3000')->sum('amount.amount');
    $result = collect($bs['equity']['lines'])->filter(fn ($l) => str_contains($l['key'], 'result'))->sum('amount.amount');
    expect($bs['balanced'])->toBeTrue()->and($result)->toBe(0)->and($retained)->toBe($before['pl']['net_profit']['amount']['amount'])
        ->and(LedgerChecks::problems())->toBe([]);
    foreach ($run('trial-balance', ['as_of' => '2026-12-31', 'hide_zero' => true])['rows'] as $r) {
        expect($r['account']['account_type'])->not->toBeIn(['income', 'expense']);
    }
})->with([11, 29, 73, 101]);
