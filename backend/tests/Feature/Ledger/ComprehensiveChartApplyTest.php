<?php

declare(strict_types=1);

use App\Actions\Ledger\ApplyChartTemplate;
use App\Actions\Ledger\Inputs\ApplyChartTemplateInput;
use App\Actions\Ledger\SetAccountHidden;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Queries\Reports\RunReport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/** A fresh company with the comprehensive chart applied; returns [fixture, company id, code → account id]. */
function comprehensiveCompany(): array
{
    $f = LedgerFixture::create();
    DB::table('accounts')->where('company_id', $f->companyId)->delete(); // the fixture's own tiny chart
    app(ApplyChartTemplate::class)->handle($f->actor, new ApplyChartTemplateInput($f->companyId, 'comprehensive'));
    $ids = DB::table('accounts')->where('company_id', $f->companyId)->pluck('id', 'code')->all();

    return [$f, $f->companyId, $ids];
}

it('applies cleanly to a new company, one account per line, with hidden flags and IFRS elements copied', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = (string) Str::uuid7();
    DB::table('companies')->insert(['id' => $company, 'tenant_id' => $f->tenantId, 'name' => 'Fresh', 'slug' => 'fresh', 'country' => 'US', 'base_currency' => 'USD']);
    $lines = array_column(json_decode((string) DB::table('chart_templates')->where('code', 'comprehensive')->value('lines'), true), null, 'code');

    $created = app(ApplyChartTemplate::class)->handle($f->actor, new ApplyChartTemplateInput($company, 'comprehensive'));

    $accounts = DB::table('accounts')->where('company_id', $company)->get()->keyBy('code');
    expect($created)->toBe(count($lines))->and($accounts)->toHaveCount($created);
    foreach ($lines as $code => $line) {
        $a = $accounts[(string) $code];
        expect($a->ifrs_element)->toBe($line['ifrs_element'] ?? null)
            ->and((bool) $a->is_hidden)->toBe($line['is_hidden'] ?? false)
            ->and($a->account_type)->toBe($line['account_type'])
            ->and($a->normal_balance)->toBe($line['normal_balance'])
            ->and($a->control_type)->toBe($line['control_type'])
            ->and($a->currency_policy)->toBe($line['currency_policy']);
    }
    $hidden = $accounts->where('is_hidden', true)->count();
    $withElement = $accounts->whereNotNull('ifrs_element')->count();
    expect($hidden)->toBeGreaterThan(50)->and($withElement)->toBeGreaterThan(80);

    // Every posting key points at an account of the new company, and extra keys are stored beside the old ones.
    $posting = json_decode((string) DB::table('company_settings')->where('company_id', $company)->value('posting_accounts'), true);
    $template = json_decode((string) DB::table('chart_templates')->where('code', 'comprehensive')->value('posting_accounts'), true);
    expect(array_keys($posting))->toEqualCanonicalizing(array_keys($template));
    foreach ($template as $key => $code) {
        expect($posting[$key])->toBe($accounts[$code]->id, $key);
    }
});

it('lands a posted journal on the balance sheet and profit and loss by account type', function () {
    $this->grant('accounts.manage');
    [$f, $companyId, $id] = comprehensiveCompany();
    $post = fn (array $lines) => postJournal($f, draftJournal($f, array_map(
        fn (array $l) => new DraftLine($id[$l[0]], debit: $l[1], credit: $l[2]), $lines,
    )));

    expect($post([['11010000', 1_000_000, 0], ['31010000', 0, 1_000_000]])->status)->toBe(JournalStatus::Posted); // capital in
    $post([['16020000', 400_000, 0], ['11010000', 0, 400_000]]);                                                    // buy plant
    $post([['11010000', 150_000, 0], ['41010000', 0, 150_000]]);                                                    // cash sale
    $post([['51010000', 60_000, 0], ['15010000', 0, 60_000]]);                                                      // cost of sales, in a roundabout way
    $post([['67020000', 10_000, 0], ['16220000', 0, 10_000]]);                                                      // depreciation of plant

    $company = Company::query()->findOrFail($companyId);
    $bs = app(RunReport::class)('balance-sheet', $company, ['as_of' => '2026-03-31', 'hide_zero' => true]);
    $pl = app(RunReport::class)('profit-and-loss', $company, ['from' => '2026-03-01', 'to' => '2026-03-31', 'hide_zero' => true]);

    $amounts = fn (array $section) => collect($section['lines'])->mapWithKeys(fn ($l) => [$l['account']['code'] ?? $l['key'] => $l['amount']['amount']])->all();
    $assets = $amounts($bs['assets']);
    expect($assets['11010000'])->toBe(750_000)       // cash
        ->and($assets['16020000'])->toBe(400_000)    // plant at cost
        ->and($assets['16220000'])->toBe(-10_000)    // accumulated depreciation reduces assets
        ->and($assets['15010000'])->toBe(-60_000)
        ->and($bs['assets']['total']['amount']['amount'])->toBe(1_080_000)
        ->and($bs['balanced'])->toBeTrue()
        ->and($amounts($bs['equity'])['31010000'])->toBe(1_000_000)
        ->and($bs['totals']['liabilities_and_equity']['amount']['amount'])->toBe(1_080_000);

    $json = json_encode($pl, JSON_THROW_ON_ERROR);
    foreach (['41010000' => 150_000, '51010000' => 60_000, '67020000' => 10_000] as $code => $amount) {
        expect($json)->toContain($code);
    }
    $sub = fn (string $k) => $pl['subtotals'][$k]['amount']['amount'];
    expect($sub('gross_profit'))->toBe(90_000)->and($sub('operating_profit'))->toBe(80_000)->and($sub('net_profit'))->toBe(80_000);
});

it('shows a hidden account in the reports when it has a balance', function () {
    $this->grant('accounts.manage');
    [$f, $companyId, $id] = comprehensiveCompany();
    (new SetAccountHiddenProbe)->hide($f, $id['34010000']);
    postJournal($f, draftJournal($f, [new DraftLine($id['11010000'], debit: 5_000), new DraftLine($id['34010000'], credit: 5_000)]));

    $bs = app(RunReport::class)('balance-sheet', Company::query()->findOrFail($companyId), ['as_of' => '2026-03-31', 'hide_zero' => true]);

    expect(collect($bs['equity']['lines'])->pluck('account.code')->all())->toContain('34010000')
        ->and(DB::table('accounts')->where('id', $id['34010000'])->value('is_hidden'))->toBeTrue();
});

/** Hides through the action, as the API does. */
final class SetAccountHiddenProbe
{
    public function hide(LedgerFixture $f, string $accountId): void
    {
        $version = (int) DB::table('accounts')->where('id', $accountId)->value('lock_version');
        app(SetAccountHidden::class)->handle($f->actor, $accountId, $version, true);
    }
}

it('hides and shows an account through the action, audited, with a version check and no change when already so', function () {
    $this->grant('accounts.manage');
    [$f, , $id] = comprehensiveCompany();
    $action = app(SetAccountHidden::class);
    $account = $id['11050000'];

    $hidden = $action->handle($f->actor, $account, 0, true);
    expect($hidden->is_hidden)->toBeTrue()->and($hidden->lock_version)->toBe(1);

    $again = $action->handle($f->actor, $account, 1, true); // already hidden: nothing changes
    expect($again->lock_version)->toBe(1);

    $shown = $action->handle($f->actor, $account, 1, false);
    expect($shown->is_hidden)->toBeFalse()->and($shown->lock_version)->toBe(2)
        ->and(DB::table('audit_events')->whereIn('action', ['account.hidden', 'account.shown'])->orderBy('id')->pluck('action')->all())->toBe(['account.hidden', 'account.shown']);

    expect(fn () => $action->handle($f->actor, $account, 0, true))->toThrow(Exception::class); // stale version
});

it('needs accounts.manage to hide an account', function () {
    $this->grant('accounts.manage');
    [$f, , $id] = comprehensiveCompany();
    $this->grant('journals.create');

    expect(fn () => app(SetAccountHidden::class)->handle($f->actor, $id['11050000'], 0, true))->toThrow(DomainRuleViolation::class);
});

it('does not stop posting to a hidden account', function () {
    $this->grant('accounts.manage');
    [$f, , $id] = comprehensiveCompany();
    app(SetAccountHidden::class)->handle($f->actor, $id['17010000'], 0, false); // goodwill starts hidden; show then hide to prove both ways
    app(SetAccountHidden::class)->handle($f->actor, $id['17010000'], 1, true);

    $journal = postJournal($f, draftJournal($f, [new DraftLine($id['17010000'], debit: 9_000), new DraftLine($id['11010000'], credit: 9_000)]));

    expect($journal->status)->toBe(JournalStatus::Posted)->and(DB::table('accounts')->where('id', $id['17010000'])->value('is_hidden'))->toBeTrue();
});
