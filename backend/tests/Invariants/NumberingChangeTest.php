<?php

declare(strict_types=1);

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

uses(MakesApiCalls::class, TradeApi::class);

/*
 * Configurable numbering (D15 item 6): a prefix or padding change reaches only a year whose sequence is created after it. Numbers already
 * issued never change, the counters stay gapless, and a sequence that exists is not touched by a later change.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

function issuedNumbersOf(string $table = 'invoices'): array
{
    return DB::table($table)->whereNotNull('number')->orderBy('number')->pluck('number')->all();
}

/** Sets a rule as the owner (or $person) from inside a test, where the protected helpers are reachable. */
function setNumberingRule(object $test, string $kind, string $prefix, int $padding, $person = null): TestResponse
{
    return (fn () => $this->asPerson($person ?? $this->owner)->putJson($this->api("numbering/{$kind}"), ['prefix' => $prefix, 'padding' => $padding], $this->key()))->call($test);
}

it('keeps issued numbers and gapless counters through a change, and applies it only to a later year', function (): void {
    $this->sale(10000);
    $this->sale(20000);
    $before = $this->inTenant(fn () => issuedNumbersOf());
    expect($before)->toBe(['INV-FY2026-00001', 'INV-FY2026-00002']);

    // No year after FY2026 exists yet: the change starts the day after FY2026 ends.
    setNumberingRule($this, 'sales_invoice', 'SI', 6)->assertOk()
        ->assertJsonPath('meta.effective_from', '2027-01-01')->assertJsonPath('meta.fiscal_year', null)
        ->assertJsonPath('data.kinds.0.kind', 'sales_invoice')->assertJsonPath('data.kinds.0.prefix', 'INV')
        ->assertJsonPath('data.kinds.0.pending.prefix', 'SI')->assertJsonPath('data.kinds.0.pending.effective_from', '2027-01-01');

    // The current year keeps its prefix and counter, even though its sequence has issued numbers and the rule exists.
    $third = $this->sale(30000);
    expect($third['number'])->toBe('INV-FY2026-00003');

    $this->inTenant(fn () => app(CreateFiscalYear::class)->handle(Actor::system($this->f->tenantId, $this->f->companyId), new CreateFiscalYearInput($this->f->companyId, new DateTimeImmutable('2027-01-01'), 'FY2027')));
    $first27 = $this->sale(10000, '2027-01-10');
    $second27 = $this->sale(10000, '2027-02-10');
    expect($first27['number'])->toBe('SI-FY2027-000001')->and($second27['number'])->toBe('SI-FY2027-000002');

    // Old numbers are as they were; every counter is still 1..n.
    $all = $this->inTenant(fn () => issuedNumbersOf());
    expect(array_slice($all, 0, 3))->toBe(['INV-FY2026-00001', 'INV-FY2026-00002', 'INV-FY2026-00003'])
        ->and(array_slice($all, 3))->toBe(['SI-FY2027-000001', 'SI-FY2027-000002'])
        ->and($this->inTenant(fn () => LedgerChecks::numberingProblems()))->toBe([]);

    // Other kinds are untouched: the journals of those invoices still read JV-FY2026-.
    expect($this->inTenant(fn () => DB::table('journals')->where('number', 'like', 'JV-FY2026-%')->count()))->toBeGreaterThan(0);

    // A second change while FY2027's sequence exists waits for the next year after it, and the 2027 sequence keeps SI.
    setNumberingRule($this, 'sales_invoice', 'XI', 5)->assertOk()->assertJsonPath('meta.effective_from', '2028-01-01');
    $this->sale(10000, '2027-03-10');
    expect($this->inTenant(fn () => issuedNumbersOf()))->toContain('SI-FY2027-000003')
        ->and($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('lets the next year take the settings when its sequence does not exist yet, and a change before then replace the waiting one', function (): void {
    $this->inTenant(fn () => app(CreateFiscalYear::class)->handle(Actor::system($this->f->tenantId, $this->f->companyId), new CreateFiscalYearInput($this->f->companyId, new DateTimeImmutable('2027-01-01'), 'FY2027')));
    setNumberingRule($this, 'sales_invoice', 'SI', 6)->assertOk()->assertJsonPath('meta.effective_from', '2027-01-01')->assertJsonPath('meta.fiscal_year', 'FY2027');
    $version = $this->asPerson($this->owner)->getJson($this->api('numbering'))->assertOk()->json('data.kinds.0.pending.version');

    $this->asPerson($this->owner)->putJson($this->api('numbering/sales_invoice'), ['prefix' => 'SAL', 'padding' => 4, 'version' => $version + 5], $this->key())
        ->assertStatus(409)->assertJsonPath('code', 'version_conflict');
    $this->asPerson($this->owner)->putJson($this->api('numbering/sales_invoice'), ['prefix' => 'SAL', 'padding' => 4, 'version' => $version], $this->key())->assertOk()
        ->assertJsonPath('data.kinds.0.pending.prefix', 'SAL')->assertJsonPath('data.kinds.0.pending.version', $version + 1);
    expect($this->inTenant(fn () => DB::table('numbering_rules')->count()))->toBe(1);

    expect($this->sale(10000)['number'])->toBe('INV-FY2026-00001');
    expect($this->sale(10000, '2027-01-05')['number'])->toBe('SAL-FY2027-0001');

    // Setting it back to what the year already uses drops the waiting change instead of storing a copy.
    setNumberingRule($this, 'credit_note', 'CN', 5)->assertOk()->assertJsonPath('meta.unchanged', true);
});

it('refuses prefixes that are malformed or that another kind uses, and a change by someone without settings.manage', function (): void {
    foreach (['inv', 'INV-', 'A B', '1AB', 'ABCDEFGHI', ''] as $bad) {
        setNumberingRule($this, 'sales_invoice', $bad, 5)->assertStatus(422);
    }
    setNumberingRule($this, 'sales_invoice', 'SI', 2)->assertStatus(422);
    setNumberingRule($this, 'credit_note', 'INV', 5)->assertStatus(422)->assertJsonPath('code', 'numbering_prefix_in_use');
    setNumberingRule($this, 'sales_invoice', 'JV', 5)->assertStatus(422)->assertJsonPath('code', 'numbering_prefix_in_use');
    setNumberingRule($this, 'sales_invoice', 'SI', 5)->assertOk();
    setNumberingRule($this, 'credit_note', 'SI', 5)->assertStatus(422)->assertJsonPath('code', 'numbering_prefix_in_use');
    // The prefix sales invoices leave behind is free for another kind from the year the change starts (no year can have both).
    setNumberingRule($this, 'credit_note', 'INV', 5)->assertOk();
    setNumberingRule($this, 'nonsense', 'ZZ', 5)->assertNotFound();
    setNumberingRule($this, 'sales_invoice', 'XI', 5, $this->accountant)->assertForbidden();
    $this->asPerson($this->accountant)->getJson($this->api('numbering'))->assertOk();
});
