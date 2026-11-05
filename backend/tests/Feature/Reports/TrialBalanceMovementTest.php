<?php

declare(strict_types=1);

use App\Queries\Reports\RunReport;
use App\Support\Reports\Export\ReportTables;
use Illuminate\Validation\ValidationException;
use Tests\Support\ReportScenario;

/*
 * 3c.18: trial balance with opening, debit and credit movement and closing over a range. Opening + movement =
 * closing per account and in total, and the closing columns equal the as-of trial balance at the end of the range.
 */

beforeEach(function (): void {
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment');
    $this->s = ReportScenario::create();
    $this->s->story();
    $this->run = fn (array $in) => app(RunReport::class)('trial-balance', $this->s->company(), $in);
});

/** Net debit - credit of a {debit, credit} pair of money cells. */
function tbNet(array $side): int
{
    return $side['debit']['amount'] - $side['credit']['amount'];
}

function expectMovementIdentity(array $tb): void
{
    foreach ($tb['rows'] as $r) {
        $code = $r['account']['code'];
        expect(tbNet($r['opening']) + $r['movement']['debit']['amount'] - $r['movement']['credit']['amount'])->toBe(tbNet($r['closing']), "account {$code}");
    }
    $t = $tb['totals'];
    expect(tbNet($t['opening']) + $t['movement']['debit']['amount'] - $t['movement']['credit']['amount'])->toBe(tbNet($t['closing']))
        ->and($t['movement']['debit']['amount'])->toBe($t['movement']['credit']['amount'])
        ->and($t['opening']['debit']['amount'])->toBe($t['opening']['credit']['amount'])
        ->and($t['closing']['debit']['amount'])->toBe($t['closing']['credit']['amount'])
        ->and($tb['balanced'])->toBeTrue();
}

it('reads opening, movement and closing for February from the hand-worked story', function (): void {
    $tb = ($this->run)(['from' => '2026-02-01', 'to' => '2026-02-28', 'hide_zero' => true]);
    $by = collect($tb['rows'])->keyBy('account.code');

    expect($tb['mode'])->toBe('movement')->and($tb['opening_as_of'])->toBe('2026-01-31');
    // Cash: 100,000 - 30,000 + 50,000 + 20,000 - 5,000 = 135,000 at 31 Jan; Feb in 25,000 + 500 + 3,000, out 2,000 + 4,000.
    expect($by['1000']['opening']['debit']['amount'])->toBe(135_000)
        ->and($by['1000']['movement']['debit']['amount'])->toBe(28_500)
        ->and($by['1000']['movement']['credit']['amount'])->toBe(6_000)
        ->and($by['1000']['closing']['debit']['amount'])->toBe(157_500)
        // Customer receivable: A 40,000 - 25,000, B -3,000 (the account nets): opening 40,000, closing 12,000.
        ->and($by['1100']['opening']['debit']['amount'])->toBe(40_000)
        ->and($by['1100']['closing']['debit']['amount'])->toBe(12_000)
        // Revenue is not closed: its opening is the January balance, February adds 500 of interest income elsewhere.
        ->and($by['4000']['opening']['credit']['amount'])->toBe(60_000)
        ->and($by['4000']['movement']['debit']['amount'])->toBe(0)
        ->and($by['4000']['closing']['credit']['amount'])->toBe(60_000);
    expectMovementIdentity($tb);
});

it('ties closing to the as-of trial balance and opening to the as-of the day before, on any range', function (): void {
    foreach ([['2026-01-01', '2026-01-31'], ['2026-01-10', '2026-02-12'], ['2026-02-15', '2026-12-31'], ['2026-03-01', '2026-03-31']] as [$from, $to]) {
        $tb = ($this->run)(['from' => $from, 'to' => $to]);
        $closing = ($this->run)(['as_of' => $to]);
        $opening = ($this->run)(['as_of' => date('Y-m-d', strtotime("{$from} -1 day"))]);
        $net = fn (array $report): array => collect($report['rows'])->mapWithKeys(fn ($r) => [$r['account']['code'] => $r['debit']['amount'] - $r['credit']['amount']])->filter()->all();
        $netOf = fn (string $part): array => collect($tb['rows'])->mapWithKeys(fn ($r) => [$r['account']['code'] => tbNet($r[$part])])->filter()->all();

        expect($netOf('closing'))->toBe($net($closing), "closing {$from}..{$to}")
            ->and($netOf('opening'))->toBe($net($opening), "opening {$from}..{$to}");
        expectMovementIdentity($tb);
    }
});

it('handles year-end closing journals as the as-of report does', function (): void {
    $this->s->closeYear();
    // Whole-year range: the closing journal's movement brings revenue and expense to zero, as the as-of report shows.
    $tb = ($this->run)(['from' => '2026-01-01', 'to' => '2026-12-31', 'hide_zero' => true]);
    $asOf = ($this->run)(['as_of' => '2026-12-31', 'hide_zero' => true]);
    $by = collect($tb['rows'])->keyBy('account.code');

    expect($by['4000']['closing']['credit']['amount'])->toBe(0)
        ->and($by['4000']['movement']['debit']['amount'])->toBe(60_000)
        ->and($by['3000']['closing']['credit']['amount'])->toBe(40_500)
        ->and(collect($asOf['rows'])->pluck('account.code')->sort()->values()->all())->toBe($by->filter(fn ($r) => tbNet($r['closing']) !== 0)->keys()->map(strval(...))->sort()->values()->all());
    expectMovementIdentity($tb);

    // The next year opens with the result already in retained earnings and nothing on revenue.
    $next = ($this->run)(['from' => '2027-01-01', 'to' => '2027-01-31', 'hide_zero' => true]);
    $opening = collect($next['rows'])->keyBy('account.code');
    expect($opening['3000']['opening']['credit']['amount'])->toBe(40_500)->and($opening->has('4000'))->toBeFalse();
});

it('needs a period or both from and to, runs by period, and exports the six amount columns', function (): void {
    expect(fn () => ($this->run)(['from' => '2026-02-01']))->toThrow(ValidationException::class);

    $byPeriod = ($this->run)(['view' => 'movement', 'period_id' => $this->s->periodId('2026-02-15'), 'hide_zero' => true]);
    expect($byPeriod['from'])->toBe('2026-02-01')->and($byPeriod['to'])->toBe('2026-02-28');

    $tb = ($this->run)(['from' => '2026-02-01', 'to' => '2026-02-28', 'hide_zero' => true]);
    $table = ReportTables::of('trial_balance', $tb, 'Acme', 2);
    expect($table->columns)->toHaveCount(8)
        ->and(array_column($table->columns, 'label'))->toBe(['Code', 'Account', 'Opening debit', 'Opening credit', 'Debit', 'Credit', 'Closing debit', 'Closing credit'])
        ->and(count($table->rows[0]->cells))->toBe(8);
});
