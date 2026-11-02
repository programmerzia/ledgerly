<?php

declare(strict_types=1);

use App\Actions\Organisation\UpdateCompanySettings;
use Illuminate\Support\Facades\DB;

/*
 * Accounts, dimensions, account dimension rules, chart templates and approval workflows over HTTP.
 * Real seeded roles: Finance Manager manages, Accountant and Viewer only read.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->manager = $this->person('Fay Manager', ['Finance Manager']);
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

const NEW_ACCOUNT = ['code' => '6100', 'name' => 'Rent', 'account_type' => 'expense', 'normal_balance' => 'debit'];

it('creates, shows, updates and deactivates an account with optimistic locking', function (): void {
    $created = $this->asPerson($this->manager)->postJson($this->api('accounts'), NEW_ACCOUNT, $this->key())
        ->assertCreated()
        ->assertJsonPath('data.code', '6100')
        ->assertJsonPath('data.currency_policy', 'base_only')
        ->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.is_postable', true)
        ->assertJsonPath('data.version', 0)
        ->assertJsonPath('data.can.update', true);
    $id = $created->json('data.id');

    $this->getJson($this->api("accounts/{$id}"))->assertOk()->assertJsonPath('data.name', 'Rent')->assertJsonPath('data.dimension_rules', []);

    $this->putJson($this->api("accounts/{$id}"), [...NEW_ACCOUNT, 'name' => 'Office rent', 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Office rent')->assertJsonPath('data.version', 1);
    $this->putJson($this->api("accounts/{$id}"), [...NEW_ACCOUNT, 'name' => 'Stale', 'version' => 0], $this->key())
        ->assertStatus(409)->assertJson(['code' => 'version_conflict', 'server_version' => 1]);
    $this->putJson($this->api("accounts/{$id}"), NEW_ACCOUNT, $this->key())->assertStatus(422)->assertJsonValidationErrors(['version']);

    $this->postJson($this->api("accounts/{$id}/deactivate"), ['version' => 1], $this->key())
        ->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.version', 2)->assertJsonPath('data.can.deactivate', false);
    $this->postJson($this->api("accounts/{$id}/deactivate"), ['version' => 2], $this->key())->assertForbidden(); // policy: already inactive
});

it('refuses duplicate codes, bad parents and inconsistent currency settings', function (): void {
    $this->asPerson($this->manager);
    $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'code' => '1000'], $this->key())->assertStatus(422)->assertJson(['code' => 'account_code_taken']);
    $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'currency_policy' => 'fixed'], $this->key())->assertStatus(422)->assertJson(['code' => 'account_currency_invalid']);
    $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'currency_policy' => 'fixed', 'fixed_currency' => 'USD'], $this->key())->assertCreated();
    $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'parent_id' => (string) Str::uuid7()], $this->key())->assertStatus(422)->assertJsonValidationErrors(['parent_id']);
    $this->postJson($this->api('accounts'), ['code' => 'x y', 'account_type' => 'cash', 'normal_balance' => 'left'], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['code', 'name', 'account_type', 'normal_balance']);

    // An account cannot become its own ancestor.
    $parent = $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'code' => '6000', 'is_postable' => false], $this->key())->json('data.id');
    $child = $this->postJson($this->api('accounts'), [...NEW_ACCOUNT, 'code' => '6001', 'parent_id' => $parent], $this->key())->assertCreated()->json('data.id');
    $this->putJson($this->api("accounts/{$parent}"), [...NEW_ACCOUNT, 'code' => '6000', 'parent_id' => $child, 'version' => 0], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'account_parent_invalid']);
});

it('freezes what an account means once it has journal lines', function (): void {
    $cash = $this->f->account('1000');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated();

    $this->asPerson($this->manager)->putJson($this->api("accounts/{$cash}"), ['code' => '1000', 'name' => 'Cash', 'account_type' => 'liability', 'normal_balance' => 'credit', 'currency_policy' => 'base_only', 'version' => 0], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'account_in_use']);
    // Renaming is fine, and the control type is untouched by this request's omission only if it is repeated.
    $this->putJson($this->api("accounts/{$cash}"), ['code' => '1000', 'name' => 'Cash on hand', 'account_type' => 'asset', 'normal_balance' => 'debit', 'control_type' => 'cash', 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Cash on hand');
});

it('lists the chart with filters and cursor pagination by code', function (): void {
    $this->asPerson($this->viewer);
    $this->getJson($this->api('accounts'))->assertOk()->assertJsonCount(8, 'data')->assertJsonPath('data.0.code', '1000')->assertJsonPath('meta.limit', 50);
    $this->getJson($this->api('accounts?type=asset'))->assertJsonCount(4, 'data');
    $this->getJson($this->api('accounts?search=receiv'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.code', '1100');
    $this->getJson($this->api('accounts?search=2000'))->assertJsonCount(1, 'data');
    $this->getJson($this->api('accounts?active=false'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('accounts?type=bogus'))->assertStatus(422);

    $first = $this->getJson($this->api('accounts?limit=3'))->assertJsonCount(3, 'data');
    $next = $this->getJson($this->api('accounts?limit=3&cursor='.$first->json('meta.next_cursor')))->assertJsonCount(3, 'data');
    expect($first->json('data.2.code'))->toBe('1200')->and($next->json('data.0.code'))->toBe('1300');
});

it('carries dimension rules on list rows, so a client never saves over rules it did not see', function (): void {
    $id = $this->asPerson($this->manager)->postJson($this->api('accounts'), NEW_ACCOUNT, $this->key())->assertCreated()->json('data.id');
    $dimension = $this->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Department'], $this->key())->assertCreated()->json('data.id');
    $this->putJson($this->api("accounts/{$id}/dimension-rules"), ['rules' => [['dimension_id' => $dimension, 'rule' => 'required']]], $this->key())->assertOk();

    $row = collect($this->getJson($this->api('accounts'))->assertOk()->json('data'))->firstWhere('id', $id);
    expect($row['dimension_rules'])->toBe([$dimension => 'required']);
});

it('takes true and false as text in report query strings, and nothing looser', function (): void {
    $this->asPerson($this->manager);
    $this->getJson($this->api('reports/trial-balance?as_of=2026-01-31&hide_zero=false'))->assertOk();
    $this->getJson($this->api('reports/trial-balance?as_of=2026-01-31&hide_zero=true'))->assertOk();
    $this->getJson($this->api('reports/trial-balance?as_of=2026-01-31&hide_zero=maybe'))->assertStatus(422)->assertJsonValidationErrors(['hide_zero']);
});

it('names real accounts of the right kind as posting accounts in every chart template', function (string $file): void {
    $chart = require database_path("seeders/charts/{$file}.php");
    $lines = collect($chart['lines'])->keyBy('code');
    $postable = $lines->reject(fn (array $l) => $lines->contains('parent_code', $l['code']));

    expect($chart['posting_accounts'])->toHaveKeys(['ar_control', 'ap_control', 'tax_output', 'retained_earnings', 'rounding', 'fx_realised', 'fx_unrealised']);
    foreach ($chart['posting_accounts'] as $key => $code) {
        $required = UpdateCompanySettings::POSTING_KEYS[$key];
        expect($postable->has($code))->toBeTrue("{$key} → {$code}");
        if ($required !== null) {
            expect($postable[$code]['control_type'])->toBe($required, "{$key} → {$code}");
        }
    }
    foreach (['fx_realised' => 'income', 'fx_realised_loss' => 'expense', 'fx_unrealised' => 'income', 'fx_unrealised_loss' => 'expense'] as $key => $type) {
        expect($postable[$chart['posting_accounts'][$key]]['account_type'])->toBe($type, $key);
    }
})->with(['ifrs_sme', 'insurance', 'non_profit', 'us_small_business']);

it('lets only an account manager change the chart', function (): void {
    $this->asPerson($this->accountant)->getJson($this->api('accounts'))->assertOk();
    $this->postJson($this->api('accounts'), NEW_ACCOUNT, $this->key())->assertForbidden()->assertJson(['code' => 'forbidden']);
    $this->asPerson($this->viewer)->postJson($this->api('accounts'), NEW_ACCOUNT, $this->key())->assertForbidden();
    $this->putJson($this->api('accounts/'.$this->f->account('1000')), [...NEW_ACCOUNT, 'version' => 0], $this->key())->assertForbidden();
    $this->getJson($this->api('accounts/'.$this->f->account('1000')))->assertOk()->assertJsonPath('data.can.update', false);
});

it('lists chart templates and applies one to a company with no accounts', function (): void {
    $beta = $this->secondCompany();
    $owner = $this->person('Owen Owner', ['Owner'], $beta->id);

    $this->asPerson($owner)->getJson($this->api('chart-templates', $beta->id))->assertOk()
        ->assertJsonStructure(['data' => [['code', 'name', 'country', 'standard', 'account_count']]]);
    $code = $this->getJson($this->api('chart-templates', $beta->id))->json('data.0.code');

    $this->postJson($this->api('apply-chart-template', $beta->id), ['template_code' => 'nope'], $this->key())->assertStatus(422)->assertJson(['code' => 'chart_template_not_found']);
    $this->postJson($this->api('apply-chart-template', $beta->id), ['template_code' => $code], $this->key())
        ->assertCreated()->assertJsonPath('data.accounts_created', fn ($n) => $n > 0);
    $this->postJson($this->api('apply-chart-template', $beta->id), ['template_code' => $code], $this->key())->assertStatus(422)->assertJson(['code' => 'chart_not_empty']);

    // The company can post straight away: the template's posting accounts are set on it.
    $settings = $this->inTenant(fn () => json_decode((string) DB::table('company_settings')->where('company_id', $beta->id)->value('posting_accounts'), true));
    expect($settings)->toHaveKeys(['ar_control', 'ap_control', 'tax_output', 'rounding', 'fx_realised', 'fx_realised_loss', 'suspense'])
        ->and($this->getJson($this->api("accounts/{$settings['ar_control']}", $beta->id))->assertOk()->json('data.control_type'))->toBe('ar');
    $this->getJson($this->api('accounts', $beta->id))->assertOk()->assertJsonPath('meta.limit', 50);

    // A viewer of company A may not even list the templates.
    $this->asPerson($this->viewer)->getJson($this->api('chart-templates'))->assertForbidden();
});

it('manages dimensions and values, caps them at eight and keeps codes unique', function (): void {
    $this->asPerson($this->manager);
    $dim = $this->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Department'], $this->key())
        ->assertCreated()->assertJsonPath('data.position', 1)->assertJsonPath('data.version', 0)->assertJsonPath('data.values', []);
    $id = $dim->json('data.id');
    $this->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Again'], $this->key())->assertStatus(422)->assertJson(['code' => 'dimension_code_taken']);

    $v = $this->postJson($this->api("dimensions/{$id}/values"), ['code' => 'OPS', 'name' => 'Operations'], $this->key())
        ->assertCreated()->assertJsonPath('data.dimension_id', $id)->assertJsonPath('data.version', 0);
    $vid = $v->json('data.id');
    $this->postJson($this->api("dimensions/{$id}/values"), ['code' => 'OPS', 'name' => 'Dup'], $this->key())->assertStatus(422)->assertJson(['code' => 'dimension_value_code_taken']);
    $this->postJson($this->api("dimensions/{$id}/values"), ['code' => 'NEW', 'name' => 'Child', 'parent_id' => $vid], $this->key())->assertCreated();
    $this->postJson($this->api("dimensions/{$id}/values"), ['code' => 'X', 'name' => 'Bad parent', 'parent_id' => (string) Str::uuid7()], $this->key())->assertStatus(422)->assertJsonValidationErrors(['parent_id']);

    $this->putJson($this->api("dimensions/{$id}/values/{$vid}"), ['name' => 'Operations team', 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.name', 'Operations team')->assertJsonPath('data.version', 1);
    $this->putJson($this->api("dimensions/{$id}/values/{$vid}"), ['name' => 'Stale', 'version' => 0], $this->key())->assertStatus(409);
    $this->putJson($this->api("dimensions/{$id}"), ['name' => 'Dept', 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.name', 'Dept')->assertJsonCount(2, 'data.values');

    $this->getJson($this->api('dimensions'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.values.0.code', 'NEW');

    $this->postJson($this->api("dimensions/{$id}/values/{$vid}/deactivate"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', false);
    $this->postJson($this->api("dimensions/{$id}/deactivate"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', false);
    $this->postJson($this->api("dimensions/{$id}/values"), ['code' => 'LATE', 'name' => 'Late'], $this->key())->assertStatus(422)->assertJson(['code' => 'dimension_inactive']);

    foreach (range(2, 8) as $n) {
        $this->postJson($this->api('dimensions'), ['code' => "D{$n}", 'name' => "Dim {$n}"], $this->key())->assertCreated()->assertJsonPath('data.position', $n);
    }
    $this->postJson($this->api('dimensions'), ['code' => 'D9', 'name' => 'Ninth'], $this->key())->assertStatus(422)->assertJson(['code' => 'dimension_limit_reached']);

    $this->asPerson($this->accountant)->getJson($this->api('dimensions'))->assertOk();
    $this->postJson($this->api('dimensions'), ['code' => 'NOPE', 'name' => 'x'], $this->key())->assertForbidden();
});

it('sets account dimension rules and enforces them at posting preview', function (): void {
    $this->asPerson($this->manager);
    $dim = $this->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Department'], $this->key())->json('data.id');
    $value = $this->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'OPS', 'name' => 'Operations'], $this->key())->json('data.id');
    $sales = $this->f->account('4000');

    $this->putJson($this->api("accounts/{$sales}/dimension-rules"), ['rules' => [['dimension_id' => $dim, 'rule' => 'required']]], $this->key())
        ->assertOk()->assertJsonPath('data.dimension_rules', [$dim => 'required']);
    $this->putJson($this->api("accounts/{$sales}/dimension-rules"), ['rules' => [['dimension_id' => (string) Str::uuid7(), 'rule' => 'required']]], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['rules.0.dimension_id']);
    $this->putJson($this->api("accounts/{$sales}/dimension-rules"), ['rules' => [['dimension_id' => $dim, 'rule' => 'sometimes']]], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['rules.0.rule']);

    $missing = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$missing}/posting-preview"), [], $this->key())
        ->assertOk()->assertJsonPath('data.valid', false)->assertJsonPath('data.violations.0.line_no', 2);

    $body = $this->journalBody();
    $body['lines'][1]['dimensions'] = [$dim => $value];
    $ok = $this->postJson($this->api('journals'), $body, $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$ok}/posting-preview"), [], $this->key())->assertOk()->assertJsonPath('data.valid', true);

    $this->asPerson($this->manager)->putJson($this->api("accounts/{$sales}/dimension-rules"), ['rules' => []], $this->key())->assertOk()->assertJsonPath('data.dimension_rules', []);
});

it('manages approval workflows, only for settings managers', function (): void {
    $body = ['document_type' => 'journal', 'name' => 'Big journals', 'source' => 'user', 'min_amount' => 100000, 'max_amount' => 500000, 'steps' => [['role' => 'Approver', 'count' => 2], ['role' => 'Finance Manager']]];
    $created = $this->asPerson($this->manager)->postJson($this->api('approval-workflows'), $body, $this->key())
        ->assertCreated()
        ->assertJsonPath('data.min_amount', ['amount' => 100000, 'currency' => 'USD'])
        ->assertJsonPath('data.max_amount.amount', 500000)
        ->assertJsonPath('data.steps', [['role' => 'Approver', 'count' => 2], ['role' => 'Finance Manager', 'count' => 1]])
        ->assertJsonPath('data.version', 0)->assertJsonPath('data.can.update', true);
    $id = $created->json('data.id');

    $this->postJson($this->api('approval-workflows'), [...$body, 'steps' => [['role' => 'Wizard']]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['steps.0.role']);
    $this->postJson($this->api('approval-workflows'), [...$body, 'max_amount' => 100], $this->key())->assertStatus(422)->assertJsonValidationErrors(['max_amount']);
    $this->postJson($this->api('approval-workflows'), [...$body, 'document_type' => 'purchase_order'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['document_type']);

    $this->putJson($this->api("approval-workflows/{$id}"), [...$body, 'name' => 'Renamed', 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.name', 'Renamed')->assertJsonPath('data.version', 1);
    $this->putJson($this->api("approval-workflows/{$id}"), [...$body, 'version' => 0], $this->key())->assertStatus(409);
    $this->getJson($this->api('approval-workflows'))->assertOk()->assertJsonCount(1, 'data');
    $this->postJson($this->api("approval-workflows/{$id}/deactivate"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', false);

    $this->asPerson($this->accountant)->getJson($this->api('approval-workflows'))->assertForbidden();
    $this->postJson($this->api('approval-workflows'), $body, $this->key())->assertForbidden();
});

it('leaves in-flight documents on the workflow they were submitted under', function (): void {
    $wf = $this->asPerson($this->manager)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->json('data.id');
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');

    $this->asPerson($this->manager)->postJson($this->api("approval-workflows/{$wf}/deactivate"), ['version' => 0], $this->key())->assertOk();
    $approver = $this->person('Abe Approver', ['Approver']);
    $this->asPerson($approver, signing: true)->getJson($this->api('approvals'))->assertJsonCount(1, 'data');
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    $this->getJson($this->api('approvals'))->assertJsonCount(0, 'data');
});

it('shows each approver only the step they can sign', function (): void {
    $this->asPerson($this->manager)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'Two steps', 'source' => 'any', 'min_amount' => 0,
        'steps' => [['role' => 'Approver'], ['role' => 'Finance Manager']],
    ], $this->key())->assertCreated();
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk();
    $approver = $this->person('Abe Approver', ['Approver']);

    $this->asPerson($this->manager, signing: true)->getJson($this->api('approvals'))->assertJsonCount(0, 'data'); // step 1 is the Approver's
    $this->asPerson($approver, signing: true)->getJson($this->api('approvals'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.step', 1);
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->getJson($this->api('approvals'))->assertJsonCount(0, 'data');
    $this->asPerson($this->manager, signing: true)->getJson($this->api('approvals'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.step', 2);
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
});
