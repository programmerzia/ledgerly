<?php

declare(strict_types=1);

use App\Http\Support\RequestActor;
use App\Models\Organisation\ApiClient;
use App\Support\ActorType;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/*
 * API clients (13 §7): token abilities `<resource>:read|write|submit`, inside their companies only, and
 * never approve, return, reverse, close, sign or manage settings, whatever the token says.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->owner = $this->person('Olga Owner', ['Owner']);
    $this->approver = $this->person('Abe Approver', ['Approver']);
});

it('drafts, previews and submits with a token, which posts directly when no workflow applies', function (): void {
    $token = $this->newToken(['journals:read', 'journals:write', 'journals:submit']);
    $this->asToken($token);

    $draft = $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated()
        ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.can.update', true)->assertJsonPath('data.can.submit', true)
        ->assertJsonPath('data.can.approve', false)->assertJsonPath('data.can.reverse', false);
    $id = $draft->json('data.id');
    $clientId = $draft->json('data.created_by');
    expect($this->inTenant(fn () => ApiClient::query()->whereKey($clientId)->exists()))->toBeTrue();

    $this->getJson($this->api("journals/{$id}"))->assertOk();
    $this->getJson($this->api('journals'))->assertOk()->assertJsonCount(1, 'data');
    $this->postJson($this->api("journals/{$id}/posting-preview"), [], $this->key())->assertOk()->assertJsonPath('data.valid', true);
    $this->putJson($this->api("journals/{$id}"), [...$this->journalBody(2000), 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.version', 1);
    $this->postJson($this->api("journals/{$id}/submit"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');

    // The audit trail names the client, not a person.
    $audit = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'journal.submitted')->first());
    expect($audit->actor_type)->toBe('api_client')->and($audit->actor_id)->toBe($clientId);
});

it('waits for a person when the tenant configured a workflow for API documents, and cannot approve it', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'API journals', 'source' => 'api', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();

    $this->asToken($this->newToken(['*']));
    $id = $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');

    // Even a wildcard token has no approve, return, reverse or void-others.
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("journals/{$id}/return"), ['comment' => 'no'], $this->key())->assertForbidden();
    $this->getJson($this->api('approvals'))->assertForbidden();

    $this->asPerson($this->approver, signing: true)->postJson($this->api("journals/{$id}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted');
    $this->asToken($this->newToken(['*']))->postJson($this->api("journals/{$id}/reverse"), [], $this->key())->assertForbidden();
});

it('may void its own draft but not someone else\'s', function (): void {
    $others = $this->asPerson($this->person('Ann Accountant', ['Accountant']))->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');

    $this->asToken($this->newToken(['journals:read', 'journals:write']));
    $mine = $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$others}/void"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("journals/{$mine}/void"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
});

it('is held to the abilities on the token', function (): void {
    $this->asToken($this->newToken(['journals:read']));
    $this->getJson($this->api('journals'))->assertOk();
    $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertForbidden();
    $this->getJson($this->api('accounts'))->assertForbidden();
    $this->getJson($this->api('fiscal-years'))->assertForbidden();

    $draft = $this->asPerson($this->person('Ann Accountant', ['Accountant']))->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->asToken($this->newToken(['journals:read', 'journals:write']));
    $this->putJson($this->api("journals/{$draft}"), [...$this->journalBody(), 'version' => 0], $this->key())->assertOk();
    $this->postJson($this->api("journals/{$draft}/submit"), [], $this->key())->assertForbidden(); // no journals:submit
    $this->getJson($this->api("journals/{$draft}"))->assertJsonPath('data.can.submit', false);
});

it('reads and writes accounts and dimensions by ability, and keeps settings and period changes for people', function (): void {
    $this->asToken($this->newToken(['accounts:read', 'dimensions:read', 'periods:read']));
    $this->getJson($this->api('accounts'))->assertOk()->assertJsonPath('data.0.can.update', false);
    $this->getJson($this->api('dimensions'))->assertOk();
    $this->getJson($this->api('fiscal-years'))->assertOk()->assertJsonPath('data.0.periods.0.can.close', false);
    $this->postJson($this->api('accounts'), ['code' => '6100', 'name' => 'Rent', 'account_type' => 'expense', 'normal_balance' => 'debit'], $this->key())->assertForbidden();
    $this->postJson($this->api('dimensions'), ['code' => 'D', 'name' => 'D'], $this->key())->assertForbidden();

    $this->asToken($this->newToken(['accounts:read', 'accounts:write', 'dimensions:write']));
    $account = $this->postJson($this->api('accounts'), ['code' => '6100', 'name' => 'Rent', 'account_type' => 'expense', 'normal_balance' => 'debit'], $this->key())
        ->assertCreated()->json('data.id');
    $this->putJson($this->api("accounts/{$account}"), ['code' => '6100', 'name' => 'Office rent', 'account_type' => 'expense', 'normal_balance' => 'debit', 'version' => 0], $this->key())->assertOk();
    $this->postJson($this->api("accounts/{$account}/deactivate"), ['version' => 1], $this->key())->assertOk();
    $this->postJson($this->api('dimensions'), ['code' => 'D', 'name' => 'D'], $this->key())->assertCreated();

    // Wildcard token: still people-only territory.
    $this->asToken($this->newToken(['*']));
    $period = $this->inTenant(fn () => $this->f->period('2026-01-15')->id);
    $year = $this->inTenant(fn () => DB::table('fiscal_years')->value('id'));
    $this->postJson($this->api("fiscal-periods/{$period}/soft-close"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("fiscal-periods/{$period}/close"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("fiscal-periods/{$period}/close-checks"))->assertForbidden();
    $this->postJson($this->api("fiscal-periods/{$period}/reopen-requests"), ['reason' => 'x'], $this->key())->assertForbidden();
    $this->postJson($this->api("fiscal-years/{$year}/year-end-close"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("fiscal-years/{$year}/lock"), [], $this->key())->assertForbidden();
    $this->postJson($this->api('fiscal-years'), ['name' => 'FY2027', 'starts_on' => '2027-01-01'], $this->key())->assertForbidden();
    $this->getJson($this->api('approval-workflows'))->assertForbidden();
    $this->postJson($this->api('approval-workflows'), ['document_type' => 'journal', 'name' => 'x', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']]], $this->key())->assertForbidden();
    $this->getJson($this->api('chart-templates'))->assertForbidden();
    $this->postJson($this->api('apply-chart-template'), ['template_code' => 'x'], $this->key())->assertForbidden();
    $this->putJson($this->api('accounts/'.$this->f->account('1000').'/dimension-rules'), ['rules' => []], $this->key())->assertOk(); // accounts:write via '*'
});

it('requires an Idempotency-Key and stays inside its companies', function (): void {
    $beta = $this->secondCompany();
    $this->asToken($this->newToken(['*']));
    $this->postJson($this->api('journals'), $this->journalBody())->assertStatus(428)->assertJson(['code' => 'idempotency_key_required']);
    $this->getJson($this->api('journals', $beta->id))->assertStatus(403)->assertJson(['code' => 'company_access_denied']);

    $key = $this->key();
    $first = $this->postJson($this->api('journals'), $this->journalBody(), $key)->assertCreated();
    $this->postJson($this->api('journals'), $this->journalBody(), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')
        ->assertJsonPath('data.id', $first->json('data.id'));
});

it('refuses a revoked client', function (): void {
    $token = $this->newToken(['*']);
    $this->inTenant(fn () => ApiClient::query()->update(['revoked_at' => now()]));
    $this->asToken($token)->getJson($this->api('journals'))->assertStatus(401);
});

it('builds an api_client actor for tokens and a user actor with its signing grant for people', function (): void {
    $request = Request::create('/api/v1/x');
    $this->inTenant(function () use ($request): void {
        $client = new ApiClient;
        $client->forceFill(['id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'name' => 'c', 'company_ids' => [$this->f->companyId], 'created_by' => $this->f->userId]);
        $request->setUserResolver(fn () => $client);
        $actor = RequestActor::from($request, $this->f->companyId);

        expect($actor->type)->toBe(ActorType::ApiClient)->and($actor->id)->toBe($client->id)->and($actor->companyId)->toBe($this->f->companyId)
            ->and($actor->hasSigningGrant)->toBeFalse()->and($actor->tenantId)->toBe($this->f->tenantId);
    });
    $request->setUserResolver(fn () => $this->owner);
    $actor = $this->inTenant(fn () => RequestActor::from($request, $this->f->companyId));
    expect($actor->type)->toBe(ActorType::User)->and($actor->id)->toBe($this->owner->id);
});

it('rate-limits per principal: 600 a minute for API clients, 300 for people', function (): void {
    $limit = RateLimiter::limiter('company-api');
    $for = function (object $principal) use ($limit): Limit {
        $request = Request::create('/api/v1/x');
        $request->setUserResolver(fn () => $principal);

        /** @var Limit */
        return $limit($request);
    };

    $client = new ApiClient;
    $client->forceFill(['id' => (string) Str::uuid7()]);
    expect($for($client)->maxAttempts)->toBe(600)->and($for($client)->key)->toContain($client->id)
        ->and($for($this->owner)->maxAttempts)->toBe(300)->and($for($this->owner)->key)->toContain($this->owner->id);

    // The throttle sits on every company route.
    $route = app('router')->getRoutes()->getByName('journals.index');
    expect($route->gatherMiddleware())->toContain('throttle:company-api');
});
