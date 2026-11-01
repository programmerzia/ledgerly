<?php

declare(strict_types=1);

use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * RLS separates tenants, not companies (13 §6). A person with access to both companies of a tenant must
 * still get a 404 for every id that belongs to the other company, on every route that binds one, and a
 * tenant must not see another tenant's ids at all.
 */

/** Everything company B owns, keyed by the route parameter name. @return array<string, string> */
function betaResources(object $test, string $betaId): array
{
    return $test->inTenant(function () use ($test, $betaId): array {
        $f = $test->f;
        $actor = new Actor(ActorType::User, $f->userId, $f->tenantId, $betaId);
        $ids = [];
        foreach (['1000' => ['asset', 'debit'], '4000' => ['income', 'credit']] as $code => [$type, $normal]) {
            $ids[$code] = (string) Str::uuid7();
            DB::table('accounts')->insert(['id' => $ids[$code], 'tenant_id' => $f->tenantId, 'company_id' => $betaId, 'code' => $code, 'name' => "B {$code}", 'account_type' => $type, 'normal_balance' => $normal]);
        }
        // CreateCompany already opened the current fiscal year.
        $year = DB::table('fiscal_years')->where('company_id', $betaId)->first();
        $period = DB::table('fiscal_periods')->where('fiscal_year_id', $year->id)->where('kind', 'regular')->orderBy('number')->value('id');
        $journal = app(CreateJournalDraft::class)->handle($actor, new JournalDraftInput($betaId, JournalType::Manual, new DateTimeImmutable('2026-03-15'), [
            new DraftLine($ids['1000'], debit: 100), new DraftLine($ids['4000'], credit: 100),
        ]));

        $dimension = (string) Str::uuid7();
        $value = (string) Str::uuid7();
        $workflow = (string) Str::uuid7();
        $reopen = (string) Str::uuid7();
        DB::table('dimensions')->insert(['id' => $dimension, 'tenant_id' => $f->tenantId, 'company_id' => $betaId, 'code' => 'DEPT', 'name' => 'Dept', 'position' => 1]);
        DB::table('dimension_values')->insert(['id' => $value, 'tenant_id' => $f->tenantId, 'company_id' => $betaId, 'dimension_id' => $dimension, 'code' => 'OPS', 'name' => 'Ops']);
        DB::table('approval_workflows')->insert(['id' => $workflow, 'tenant_id' => $f->tenantId, 'company_id' => $betaId, 'document_type' => 'journal', 'name' => 'B flow', 'steps' => json_encode([['role' => 'Approver']])]);
        DB::table('period_reopen_requests')->insert(['id' => $reopen, 'tenant_id' => $f->tenantId, 'company_id' => $betaId, 'fiscal_period_id' => $period, 'requested_by' => $f->userId, 'reason' => 'x']);

        return [
            'account' => $ids['1000'], 'dimension' => $dimension, 'value' => $value, 'year' => $year->id, 'period' => $period,
            'journal' => $journal->id, 'workflow' => $workflow, 'reopen' => $reopen,
        ];
    });
}

beforeEach(function (): void {
    $this->setUpWorld();
    $this->beta = $this->secondCompany();
    $this->both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->both->id, $this->beta->id, 'Owner')));
    $this->b = betaResources($this, $this->beta->id);
});

it('answers 404 for every route that binds an id of the other company', function (): void {
    $b = $this->b;
    $dimensionA = $this->asPerson($this->both, signing: true)->postJson($this->api('dimensions'), ['code' => 'REGION', 'name' => 'Region'], $this->key())->assertCreated()->json('data.id');

    $routes = [
        ['GET', "accounts/{$b['account']}"], ['PUT', "accounts/{$b['account']}"], ['POST', "accounts/{$b['account']}/deactivate"],
        ['PUT', "accounts/{$b['account']}/dimension-rules"],
        ['PUT', "dimensions/{$b['dimension']}"], ['POST', "dimensions/{$b['dimension']}/deactivate"], ['POST', "dimensions/{$b['dimension']}/values"],
        ['PUT', "dimensions/{$b['dimension']}/values/{$b['value']}"], ['POST', "dimensions/{$b['dimension']}/values/{$b['value']}/deactivate"],
        // A real value of another dimension of the same company is just as foreign under this dimension.
        ['PUT', "dimensions/{$dimensionA}/values/{$b['value']}"],
        ['POST', "fiscal-years/{$b['year']}/year-end-close"], ['POST', "fiscal-years/{$b['year']}/lock"],
        ['POST', "fiscal-periods/{$b['period']}/soft-close"], ['GET', "fiscal-periods/{$b['period']}/close-checks"],
        ['POST', "fiscal-periods/{$b['period']}/close"], ['POST', "fiscal-periods/{$b['period']}/reopen-requests"],
        ['POST', "reopen-requests/{$b['reopen']}/approve"], ['POST', "reopen-requests/{$b['reopen']}/reject"],
        ['GET', "journals/{$b['journal']}"], ['PUT', "journals/{$b['journal']}"], ['POST', "journals/{$b['journal']}/posting-preview"],
        ['POST', "journals/{$b['journal']}/submit"], ['POST', "journals/{$b['journal']}/approve"], ['POST', "journals/{$b['journal']}/return"],
        ['POST', "journals/{$b['journal']}/void"], ['POST', "journals/{$b['journal']}/reverse"],
        ['PUT', "approval-workflows/{$b['workflow']}"], ['POST', "approval-workflows/{$b['workflow']}/deactivate"],
    ];
    foreach ($routes as [$method, $path]) {
        $this->json($method, $this->api($path), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }

    // The same ids under their own company work, so the 404s are about the company and nothing else.
    $this->getJson($this->api("journals/{$b['journal']}", $this->beta->id))->assertOk()->assertJsonPath('data.id', $b['journal']);
    $this->getJson($this->api("accounts/{$b['account']}", $this->beta->id))->assertOk();
    $this->postJson($this->api("journals/{$b['journal']}/posting-preview", $this->beta->id), [], $this->key())->assertOk();

    // Nothing of company B was touched.
    expect($this->inTenant(fn () => Journal::query()->where('company_id', $this->beta->id)->where('status', 'draft')->count()))->toBe(1)
        ->and($this->inTenant(fn () => DB::table('accounts')->where('id', $b['account'])->value('is_active')))->toBeTrue()
        ->and($this->inTenant(fn () => DB::table('period_reopen_requests')->where('id', $b['reopen'])->value('status')))->toBe('pending');
});

it('refuses ids of the other company inside request bodies as validation errors', function (): void {
    $b = $this->b;
    $this->asPerson($this->both);

    $body = $this->journalBody();
    $body['lines'][0]['account_id'] = $b['account'];
    $this->postJson($this->api('journals'), $body, $this->key())->assertStatus(422)->assertJsonValidationErrors(['lines.0.account_id']);

    $body = $this->journalBody();
    $body['fiscal_period_id'] = $b['period'];
    $this->postJson($this->api('journals'), $body, $this->key())->assertStatus(422)->assertJsonValidationErrors(['fiscal_period_id']);

    $body = $this->journalBody();
    $body['lines'][0]['dimensions'] = [$b['dimension'] => $b['value']];
    $this->postJson($this->api('journals'), $body, $this->key())->assertStatus(422)->assertJsonValidationErrors(['lines.0.dimensions']);

    $dim = $this->postJson($this->api('dimensions'), ['code' => 'REGION', 'name' => 'Region'], $this->key())->json('data.id');
    $own = $this->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'N', 'name' => 'North'], $this->key())->json('data.id');
    $body = $this->journalBody();
    $body['lines'][0]['dimensions'] = [$dim => $b['value']]; // a real value, but of company B
    $this->postJson($this->api('journals'), $body, $this->key())->assertStatus(422)->assertJsonValidationErrors(['lines.0.dimensions.'.$dim]);
    $body['lines'][0]['dimensions'] = [$dim => $own];
    $this->postJson($this->api('journals'), $body, $this->key())->assertCreated();

    $this->postJson($this->api('accounts'), ['code' => '9000', 'name' => 'X', 'account_type' => 'asset', 'normal_balance' => 'debit', 'parent_id' => $b['account']], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id']);
    $this->putJson($this->api('accounts/'.$this->f->account('1000').'/dimension-rules'), ['rules' => [['dimension_id' => $b['dimension'], 'rule' => 'required']]], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['rules.0.dimension_id']);
    $this->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'S', 'name' => 'South', 'parent_id' => $b['value']], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id']);
});

it('keeps one company\'s lists to that company', function (): void {
    $this->asPerson($this->both);
    $this->getJson($this->api('journals'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('journals', $this->beta->id))->assertJsonCount(1, 'data');
    $this->getJson($this->api('accounts'))->assertJsonCount(8, 'data');
    $this->getJson($this->api('accounts', $this->beta->id))->assertJsonCount(2, 'data');
    $this->getJson($this->api('dimensions'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('approval-workflows'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('fiscal-years'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.periods.0.fiscal_year_id', fn ($id) => $id !== $this->b['year']);
});

it('is a 404 for a company the person has no access to and for a company of another tenant', function (): void {
    $accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->asPerson($accountant);
    $this->getJson($this->api('journals', $this->beta->id))->assertStatus(403)->assertJson(['code' => 'company_access_denied']);

    $other = LedgerFixture::create('USD', 'other');
    $foreignJournal = app(CreateJournalDraft::class)->handle($other->actor, new JournalDraftInput($other->companyId, JournalType::Manual, new DateTimeImmutable('2026-03-15'), [
        new DraftLine($other->account('1000'), debit: 100), new DraftLine($other->account('4000'), credit: 100),
    ]));

    $this->asPerson($this->both);
    $this->getJson($this->api('journals', $other->companyId))->assertNotFound()->assertJson(['code' => 'company_not_found']);
    $this->getJson($this->api("journals/{$foreignJournal->id}"))->assertNotFound()->assertJson(['code' => 'not_found']);
    $this->postJson($this->api("journals/{$foreignJournal->id}/reverse"), [], $this->key())->assertNotFound();
    $this->getJson($this->api('accounts/'.$other->account('1000')))->assertNotFound();
    $this->getJson($this->api('journals'))->assertJsonCount(0, 'data');
    // Nothing of the other tenant leaks into an id lookup either.
    $this->getJson($this->api('journals/'.Str::uuid7()))->assertNotFound();
});
