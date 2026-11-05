<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

uses(MakesApiCalls::class, TradeApi::class);

/*
 * Week-based fiscal calendars (plan 3c.26a). A period is a date range, so everything that sits on periods (posting, balances, reports,
 * close, year-end, last-year comparison) must work when periods are 4 or 5 weeks long, not calendar months.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    // FY2026 (calendar months) exists; the week-based years follow it day for day.
    $this->createYear = fn (string $name, string $start, array $extra = []) => $this->asPerson($this->owner)
        ->postJson($this->api('fiscal-years'), ['name' => $name, 'starts_on' => $start, 'calendar' => '4-4-5', ...$extra], $this->key());
    $this->periodAt = fn (string $date) => $this->inTenant(fn () => $this->f->period($date));
    $this->post = fn (int $amount, string $date) => $this->asPerson($this->accountant, signing: true)
        ->postJson($this->api('journals'), $this->journalBody($amount, $date), $this->key())->assertCreated()->json('data.id');
    $this->submit = fn (string $id) => $this->postJson($this->api("journals/{$id}/submit"), [], $this->key());
});

it('creates a 4-4-5 year as 12 week periods plus the adjustment period, and says how it was cut', function (): void {
    $year = ($this->createYear)('FY2027', '2027-01-01')->assertCreated()
        ->assertJsonPath('data.calendar', '4-4-5')->assertJsonPath('data.extra_week_period', null)
        ->assertJsonPath('data.starts_on', '2027-01-01')->assertJsonPath('data.ends_on', '2027-12-30')
        ->assertJsonCount(13, 'data.periods')->json('data');

    $regular = array_slice($year['periods'], 0, 12);
    expect(array_column($regular, 'starts_on')[1])->toBe('2027-01-29')
        ->and($regular[0]['ends_on'])->toBe('2027-01-28')
        ->and($year['periods'][12]['kind'])->toBe('adjustment')->and($year['periods'][12]['ends_on'])->toBe('2027-12-30');
    $days = array_map(fn ($p) => (strtotime($p['ends_on']) - strtotime($p['starts_on'])) / 86400 + 1, $regular);
    expect($days)->toBe([28, 28, 35, 28, 28, 35, 28, 28, 35, 28, 28, 35]);
});

it('takes a 53rd week in the chosen period, and refuses nonsense', function (): void {
    ($this->createYear)('FY2027', '2027-01-01')->assertCreated();
    $year = ($this->createYear)('FY2027 53', '2027-12-31', ['extra_week_period' => 12])->assertCreated()
        ->assertJsonPath('data.extra_week_period', 12)->assertJsonPath('data.ends_on', '2029-01-04')->json('data');
    // 53 weeks: 371 days from 2027-12-31 ends 2029-01-04? (370 days after the start).
    expect($year['periods'][11]['ends_on'])->toBe('2029-01-04');
    ($this->createYear)('Bad', '2030-01-01', ['extra_week_period' => 13])->assertStatus(422);
    ($this->createYear)('Bad2', '2030-01-01', ['calendar' => '4-4-6'])->assertStatus(422);
    $this->asPerson($this->owner)->postJson($this->api('fiscal-years'), ['name' => 'Bad3', 'starts_on' => '2030-01-15', 'extra_week_period' => 3], $this->key())->assertStatus(422);
    // Overlap is still refused for week-based years.
    ($this->createYear)('Dup', '2027-06-01')->assertStatus(422)->assertJson(['code' => 'fiscal_year_overlap']);
});

it('posts across a period boundary into the right period, and every balance and report ties to the period ranges', function (): void {
    ($this->createYear)('FY2027', '2027-01-01')->assertCreated();
    $p1 = ($this->periodAt)('2027-01-28');
    $p2 = ($this->periodAt)('2027-01-29');
    $p3 = ($this->periodAt)('2027-02-26');
    expect([$p1->number, $p2->number, $p3->number])->toBe([1, 2, 3])
        ->and(($this->periodAt)('2027-02-25')->id)->toBe($p2->id);

    foreach ([[1000, '2027-01-28'], [2000, '2027-01-29'], [4000, '2027-02-25'], [8000, '2027-02-26'], [16000, '2027-04-01']] as [$amount, $date]) {
        ($this->submit)(($this->post)($amount, $date))->assertOk()->assertJsonPath('data.status', 'posted');
    }

    // Each journal sits in the period whose range holds its date; balances per period add up to the lines by date.
    $this->inTenant(function () use ($p1, $p2, $p3): void {
        $byPeriod = DB::table('journals')->where('company_id', $this->f->companyId)->where('journal_date', '>=', '2027-01-01')
            ->pluck('fiscal_period_id', 'journal_date')->mapWithKeys(fn ($id, $d) => [substr((string) $d, 0, 10) => $id])->all();
        expect($byPeriod['2027-01-28'])->toBe($p1->id)->and($byPeriod['2027-01-29'])->toBe($p2->id)->and($byPeriod['2027-02-25'])->toBe($p2->id)
            ->and($byPeriod['2027-02-26'])->toBe($p3->id)->and($byPeriod['2027-04-01'])->toBe($p3->id);

        $sales = $this->f->account('4000');
        $balances = DB::table('account_period_balances')->where('account_id', $sales)->pluck('credit', 'fiscal_period_id');
        expect((int) $balances[$p1->id])->toBe(1000)->and((int) $balances[$p2->id])->toBe(6000)->and((int) $balances[$p3->id])->toBe(24000);
        // Debits equal credits in every period and overall: no posting fell between periods.
        expect((int) DB::table('account_period_balances')->where('company_id', $this->f->companyId)->sum('debit'))
            ->toBe((int) DB::table('account_period_balances')->where('company_id', $this->f->companyId)->sum('credit'));
    });

    $this->asPerson($this->owner);
    $net = fn (string $period, string $basis) => $this->getJson($this->api("reports/profit-and-loss?period_id={$period}&basis={$basis}"))->assertOk()->json('data.subtotals.net_profit.amount.amount');
    expect($net($p1->id, 'month'))->toBe(1000)->and($net($p2->id, 'month'))->toBe(6000)->and($net($p3->id, 'month'))->toBe(24000)
        ->and($net($p3->id, 'ytd'))->toBe(31000);
    $this->getJson($this->api('reports/trial-balance?period_id='.$p2->id))->assertOk()->assertJsonPath('data.balanced', true)->assertJsonPath('data.as_of', '2027-02-25');
    $this->getJson($this->api('reports/balance-sheet?period_id='.$p3->id))->assertOk()->assertJsonPath('data.balanced', true);
});

it('closes a week period on its own dates: the day before is closed, the first day of the next is still open', function (): void {
    ($this->createYear)('FY2027', '2027-01-01')->assertCreated();
    $p1 = ($this->periodAt)('2027-01-28');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("fiscal-periods/{$p1->id}/close"), ['waivers' => ['DRAFTS' => 'none open']], $this->key())->assertOk()->assertJsonPath('data.status', 'closed');

    $inP1 = ($this->post)(500, '2027-01-28');
    ($this->submit)($inP1)->assertStatus(422)->assertJson(['code' => 'period_closed']);
    $inP2 = ($this->post)(500, '2027-01-29');
    ($this->submit)($inP2)->assertOk()->assertJsonPath('data.status', 'posted');
});

it('compares with the same period of last year, not the same calendar dates', function (): void {
    ($this->createYear)('FY2027', '2027-01-01')->assertCreated();
    ($this->createYear)('FY2028', '2027-12-31')->assertCreated(); // 2027-12-31 to 2028-12-28, 52 weeks
    ($this->submit)(($this->post)(1000, '2027-02-10'))->assertOk();   // FY2027 P2 (2027-01-29 to 2027-02-25)
    ($this->submit)(($this->post)(3000, '2028-02-09'))->assertOk();   // FY2028 P2 (2028-01-28 to 2028-02-24)
    $p2next = ($this->periodAt)('2028-02-09');
    $p2last = ($this->periodAt)('2027-02-10');
    expect([$p2next->number, $p2last->number])->toBe([2, 2]);

    $pl = $this->asPerson($this->owner)->getJson($this->api("reports/profit-and-loss?period_id={$p2next->id}&basis=month&comparison=previous_year"))->assertOk()->json('data');
    expect($pl['comparison']['from'])->toBe('2027-01-29')->and($pl['comparison']['to'])->toBe('2027-02-25')
        ->and($pl['subtotals']['net_profit']['amount']['amount'])->toBe(3000)
        ->and($pl['subtotals']['net_profit']['comparison']['amount'])->toBe(1000);
});

it('closes the year and posts the year-end into the adjustment period of a 53-week year', function (): void {
    ($this->createYear)('FY2027', '2027-01-01', ['extra_week_period' => 3])->assertCreated()->assertJsonPath('data.ends_on', '2028-01-06');
    ($this->submit)(($this->post)(9000, '2027-03-05'))->assertOk();
    $this->asPerson($this->owner, signing: true);
    $year = collect($this->getJson($this->api('fiscal-years'))->json('data'))->firstWhere('name', 'FY2027');
    foreach (array_slice($year['periods'], 0, 12) as $p) {
        $this->postJson($this->api("fiscal-periods/{$p['id']}/close"), ['waivers' => ['DRAFTS' => 'none open', 'APPROVALS' => 'none']], $this->key())->assertOk();
    }
    $this->postJson($this->api("fiscal-years/{$year['id']}/year-end-close"), [], $this->key())->assertOk();
    $closing = $this->inTenant(fn () => DB::table('journals')->where('journal_type', 'closing')->where('company_id', $this->f->companyId)->first());
    expect($closing)->not->toBeNull()
        ->and((string) $this->inTenant(fn () => DB::table('fiscal_periods')->where('id', $closing->fiscal_period_id)->value('kind')))->toBe('adjustment');
});
