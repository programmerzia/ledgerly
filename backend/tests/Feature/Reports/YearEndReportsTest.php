<?php

declare(strict_types=1);

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Domain\Ledger\JournalType;
use App\Queries\Reports\RunReport;
use App\Support\Actor;
use Tests\Support\ReportScenario;

/*
 * D7: the year-end close moves the result to retained earnings. Profit and loss leaves closing journals out,
 * so it does not change; the balance sheet includes them, so retained earnings carries the result and the
 * "current year result" line empties.
 */

beforeEach(function (): void {
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment', 'journals.reverse');
    $this->s = ReportScenario::create();
    $this->s->story();
    $this->run = fn (string $r, array $in) => app(RunReport::class)($r, $this->s->company(), $in);
    $this->dec = $this->s->periodId('2026-12-15');
});

function equityByKey(array $bs): array
{
    $out = [];
    foreach ($bs['equity']['lines'] as $l) {
        $out[isset($l['account']) ? $l['account']['code'] : $l['key']] = $l['amount']['amount'];
    }

    return $out;
}

it('leaves profit and loss unchanged by the close and carries the result in retained earnings', function (): void {
    $plBefore = ($this->run)('profit-and-loss', ['period_id' => $this->dec, 'basis' => 'ytd']);
    $bsBefore = ($this->run)('balance-sheet', ['period_id' => $this->dec, 'hide_zero' => true]);
    expect($plBefore['subtotals']['net_profit']['amount']['amount'])->toBe(40_500)
        ->and(equityByKey($bsBefore))->toBe(['3100' => 100_000, 'current_year_result:' => 40_500]);

    $closing = $this->s->closeYear();
    expect($closing?->journal_type)->toBe(JournalType::Closing);

    $plAfter = ($this->run)('profit-and-loss', ['period_id' => $this->dec, 'basis' => 'ytd']);
    $jan = ($this->run)('profit-and-loss', ['period_id' => $this->s->periodId('2026-01-15')]);
    $bsAfter = ($this->run)('balance-sheet', ['period_id' => $this->dec, 'hide_zero' => true]);

    unset($plBefore['generated_at'], $plAfter['generated_at']);
    expect($plAfter)->toEqual($plBefore)
        ->and($jan['subtotals']['net_profit']['amount']['amount'])->toBe(42_000)
        ->and(equityByKey($bsAfter))->toBe(['3000' => 40_500, '3100' => 100_000])      // result now in retained earnings
        ->and($bsAfter['equity']['total']['amount']['amount'])->toBe($bsBefore['equity']['total']['amount']['amount'])
        ->and($bsAfter['assets']['total'])->toEqual($bsBefore['assets']['total'])
        ->and($bsAfter['balanced'])->toBeTrue();

    // The trial balance shows income and expense accounts closed to zero.
    $tb = ($this->run)('trial-balance', ['period_id' => $this->dec, 'hide_zero' => true]);
    $codes = collect($tb['rows'])->pluck('account.code')->all();
    expect($codes)->not->toContain('4000', '5000', '5100', '6500', '6800')->and($tb['balanced'])->toBeTrue();

    // A date before the closing journal (its date is the year end) still shows the open result.
    $before = ($this->run)('balance-sheet', ['as_of' => '2026-12-30', 'hide_zero' => true]);
    expect(equityByKey($before))->toBe(['3100' => 100_000, 'current_year_result:' => 40_500]);

    // The cash flow ignores the closing journal: retained earnings shows no movement.
    $cf = ($this->run)('cash-flow', ['period_id' => $this->dec, 'basis' => 'ytd']);
    expect($cf['reconciles'])->toBeTrue()->and($cf['financing']['total']['amount'])->toBe(150_000);
});

it('counts audit adjustments in the adjustment period in profit and loss, and re-closing keeps the result', function (): void {
    $this->s->closeYear();
    $this->s->post('2026-12-31', [['5000', 1_000, 0], ['1300', 0, 1_000]], JournalType::Adjustment, $this->s->f->adjustmentPeriod()->id);

    $dec = ($this->run)('profit-and-loss', ['period_id' => $this->dec]);
    $ytd = ($this->run)('profit-and-loss', ['period_id' => $this->dec, 'basis' => 'ytd']);
    expect($dec['subtotals']['net_profit']['amount']['amount'])->toBe(-1_000)
        ->and($ytd['subtotals']['net_profit']['amount']['amount'])->toBe(39_500);

    // Until the close is re-run the adjustment shows as a current-year result against the closed year.
    $bs = ($this->run)('balance-sheet', ['period_id' => $this->dec, 'hide_zero' => true]);
    expect($bs['balanced'])->toBeTrue()->and(equityByKey($bs)['current_year_result:'])->toBe(-1_000);

    $this->s->closeYear();   // reverses the first closing journal and posts a new one
    $bs = ($this->run)('balance-sheet', ['period_id' => $this->dec, 'hide_zero' => true]);
    expect(equityByKey($bs))->toBe(['3000' => 39_500, '3100' => 100_000])->and($bs['balanced'])->toBeTrue()
        ->and(($this->run)('profit-and-loss', ['period_id' => $this->dec, 'basis' => 'ytd'])['subtotals']['net_profit']['amount']['amount'])->toBe(39_500);
});

it('shows a result of the next year separately from the closed year', function (): void {
    $this->s->closeYear();
    // Jan 2027 needs a fiscal year.
    app(CreateFiscalYear::class)->handle(Actor::system($this->s->f->tenantId, $this->s->f->companyId), new CreateFiscalYearInput($this->s->f->companyId, new DateTimeImmutable('2027-01-01'), 'FY2027'));
    $this->s->post('2027-01-10', [['1000', 900, 0], ['4000', 0, 900]]);

    $bs = ($this->run)('balance-sheet', ['as_of' => '2027-01-31', 'hide_zero' => true]);
    expect(equityByKey($bs))->toBe(['3000' => 40_500, '3100' => 100_000, 'current_year_result:' => 900])->and($bs['balanced'])->toBeTrue();
});
