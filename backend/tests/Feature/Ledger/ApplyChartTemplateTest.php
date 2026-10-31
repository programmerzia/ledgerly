<?php

declare(strict_types=1);

use App\Actions\Ledger\ApplyChartTemplate;
use App\Actions\Ledger\Inputs\ApplyChartTemplateInput;
use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Platform\ChartTemplate;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/** A company in the fixture's tenant that has no accounts yet. */
function chartTplCompany(LedgerFixture $f, string $slug = 'fresh'): string
{
    $id = (string) Str::uuid7();
    DB::table('companies')->insert([
        'id' => $id, 'tenant_id' => $f->tenantId, 'name' => ucfirst($slug), 'slug' => $slug,
        'country' => 'US', 'base_currency' => 'USD',
    ]);

    return $id;
}

function chartTplApply(LedgerFixture $f, string $companyId, string $template = 'ifrs_sme', ?Actor $actor = null): int
{
    return app(ApplyChartTemplate::class)->handle($actor ?? $f->actor, new ApplyChartTemplateInput($companyId, $template));
}

function chartTplAccountCount(string $companyId): int
{
    return DB::table('accounts')->where('company_id', $companyId)->count();
}

it('copies a template into an empty company, one account per line', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);
    $lines = ChartTemplate::query()->where('code', 'ifrs_sme')->firstOrFail()->lines;

    $created = chartTplApply($f, $company);

    $accounts = DB::table('accounts')->where('company_id', $company)->get()->keyBy('code');
    expect($created)->toBe(count($lines))->and($accounts)->toHaveCount($created);

    $headers = array_flip(array_filter(array_column($lines, 'parent_code')));
    foreach ($lines as $line) {
        $account = $accounts[$line['code']];
        expect($account->tenant_id)->toBe($f->tenantId)
            ->and($account->name)->toBe($line['name'])
            ->and($account->account_type)->toBe($line['account_type'])
            ->and($account->account_subtype)->toBe($line['account_subtype'])
            ->and($account->normal_balance)->toBe($line['normal_balance'])
            ->and($account->control_type)->toBe($line['control_type'])
            ->and($account->currency_policy)->toBe($line['currency_policy'])
            ->and($account->fixed_currency)->toBeNull()
            ->and($account->description)->toBe($line['description'])
            ->and($account->parent_id)->toBe($line['parent_code'] === null ? null : $accounts[$line['parent_code']]->id)
            ->and($account->is_postable)->toBe(! isset($headers[$line['code']]))
            ->and($account->is_active)->toBeTrue()
            ->and($account->allow_manual_journals)->toBeFalse();
    }
});

it('creates the control accounts posting rules look up', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);

    chartTplApply($f, $company);

    $tally = DB::table('accounts')->where('company_id', $company)->pluck('control_type')->countBy()->all();
    expect([$tally['ar'], $tally['ap'], $tally['retained_earnings'], $tally['suspense']])->toBe([1, 1, 1, 1])
        ->and($tally['cash'])->toBeGreaterThanOrEqual(1)
        ->and($tally['bank'])->toBeGreaterThanOrEqual(1)
        ->and($tally['tax'])->toBeGreaterThanOrEqual(1);
});

it('applies every starter template', function (string $code) {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);

    $created = chartTplApply($f, $company, $code);

    expect($created)->toBe(count(ChartTemplate::query()->where('code', $code)->firstOrFail()->lines))
        ->and(chartTplAccountCount($company))->toBe($created);
})->with(['ifrs_sme', 'us_small_business', 'non_profit', 'insurance']);

it('audits the application with the template and the account count', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);

    $created = chartTplApply($f, $company, 'non_profit');

    $events = DB::table('audit_events')->where('action', 'chart.applied')->get();
    expect($events)->toHaveCount(1)
        ->and($events[0]->subject_type)->toBe('companies')
        ->and($events[0]->subject_id)->toBe($company)
        ->and(json_decode($events[0]->context, true))->toEqual(['template' => 'non_profit', 'accounts' => $created]);
});

it('refuses a company that already has a chart', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create(); // its own company already has eight accounts
    $company = chartTplCompany($f);
    $created = chartTplApply($f, $company);
    $before = DB::table('accounts')->count();

    foreach ([[$company, 'ifrs_sme'], [$company, 'insurance'], [$f->companyId, 'ifrs_sme']] as [$target, $code]) {
        expect(fn () => chartTplApply($f, $target, $code))
            ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'chart_not_empty');
    }

    expect(DB::table('accounts')->count())->toBe($before)
        ->and(chartTplAccountCount($company))->toBe($created)
        ->and(DB::table('audit_events')->where('action', 'chart.applied')->count())->toBe(1);
});

it('counts soft-deleted accounts as a chart, since they still own their codes', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);
    chartTplApply($f, $company);
    DB::table('accounts')->where('company_id', $company)->update(['deleted_at' => '2026-03-01 00:00:00+00']);

    expect(fn () => chartTplApply($f, $company))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'chart_not_empty');
});

it('refuses an unknown template and creates nothing', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);

    expect(fn () => chartTplApply($f, $company, 'klingon'))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'chart_template_not_found');

    expect(chartTplAccountCount($company))->toBe(0)
        ->and(DB::table('audit_events')->where('action', 'chart.applied')->count())->toBe(0);
});

it('needs accounts.manage on the company', function () {
    $this->grant('journals.create');
    $f = LedgerFixture::create();
    $company = chartTplCompany($f);

    expect(fn () => chartTplApply($f, $company))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'forbidden');

    expect(chartTplAccountCount($company))->toBe(0);
});

it('follows the permission matrix: the Owner may apply a template, an Accountant may not', function () {
    $f = LedgerFixture::create(); // the real permission checker, no fake
    $company = app(CreateCompany::class)->handle($f->actor, new CreateCompanyInput('Matrix Co', 'US', 'USD', 1));
    $elsewhere = chartTplCompany($f, 'elsewhere'); // same tenant, but the creator holds no role there

    $accountantId = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $accountantId, 'name' => 'Ann', 'email' => 'ann@matrix.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $accountantId, 'role' => 'member']);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($accountantId, $company->id, 'Accountant'));
    $accountant = new Actor(ActorType::User, $accountantId, $f->tenantId, $company->id, requestId: 'test');

    expect(fn () => chartTplApply($f, $company->id, 'ifrs_sme', $accountant))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'forbidden');
    expect(fn () => chartTplApply($f, $elsewhere))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'forbidden');
    expect(chartTplAccountCount($company->id) + chartTplAccountCount($elsewhere))->toBe(0);

    expect(chartTplApply($f, $company->id))->toBeGreaterThan(0);
});

it('cannot reach another tenant\'s company', function () {
    $this->grant('accounts.manage');
    $alpha = LedgerFixture::create(slug: 'alpha');
    $company = chartTplCompany($alpha);
    $beta = LedgerFixture::create(slug: 'beta');

    expect(fn () => chartTplApply($beta, $company))->toThrow(ModelNotFoundException::class);

    app(TenantContext::class)->run($alpha->tenantId, fn () => expect(chartTplAccountCount($company))->toBe(0));
});

it('builds accounts the posting engine accepts, and refuses a group header', function () {
    $this->grant('accounts.manage');
    $f = LedgerFixture::create();
    DB::table('accounts')->where('company_id', $f->companyId)->delete(); // start from the fixture's empty company
    chartTplApply($f, $f->companyId);
    $id = fn (string $code) => (string) DB::table('accounts')->where('company_id', $f->companyId)->where('code', $code)->value('id');

    $sale = postJournal($f, draftJournal($f, [
        new DraftLine($id('1000'), debit: 5000),
        new DraftLine($id('4000'), credit: 5000),
    ]));
    expect($sale->status)->toBe(JournalStatus::Posted);

    $toHeader = draftJournal($f, [
        new DraftLine($id('10'), debit: 5000),
        new DraftLine($id('4000'), credit: 5000),
    ]);
    try {
        postJournal($f, $toHeader);
        $this->fail('expected the header to be refused');
    } catch (PostingRejected $e) {
        expect(array_map(fn ($v) => $v->code, $e->violations))->toBe(['account_not_postable']);
    }
});
