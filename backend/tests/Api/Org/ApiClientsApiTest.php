<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->admin = $this->person('Ada Admin', [], org: 'admin');
});

it('creates a client with a token that works inside its companies, and shows the secret once', function (): void {
    $res = $this->asPerson($this->admin)->postJson('/api/v1/api-clients', [
        'name' => 'ERP sync', 'company_ids' => [$this->f->companyId], 'abilities' => ['invoices:read', 'invoices:write', 'invoices:submit'], 'token_name' => 'prod',
    ], $this->key())->assertCreated()->assertJsonPath('data.name', 'ERP sync')->assertJsonPath('data.is_active', true)->assertJsonPath('data.tokens.0.name', 'prod')
        ->assertJsonPath('data.tokens.0.abilities', ['invoices:read', 'invoices:write', 'invoices:submit'])->json('data');
    expect($res['token'])->toContain('|')->and(json_encode($res['tokens']))->not->toContain($res['token']);

    // Never again: lists and reads carry no secret, and only a hash is stored.
    $list = $this->getJson('/api/v1/api-clients')->assertOk()->assertJsonCount(1, 'data')->json('data');
    expect($list[0])->not->toHaveKey('token')->and(json_encode($list))->not->toContain(explode('|', $res['token'])[1]);
    $stored = DB::table('personal_access_tokens')->value('token');
    expect($stored)->not->toBe(explode('|', $res['token'])[1])->and($stored)->toHaveLength(64);

    // The token works for the abilities and company it was given, and nothing else.
    $this->asToken($res['token'])->getJson($this->api('invoices'))->assertOk();
    $this->asToken($res['token'])->getJson($this->api('bills'))->assertForbidden();
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    $this->asToken($res['token'])->postJson($this->api("invoices/{$draft['id']}/approve"), [], $this->key())->assertForbidden(); // no token can approve
    $beta = $this->secondCompany();
    $this->asToken($res['token'])->getJson($this->api('invoices', $beta->id))->assertStatus(403);

    // Audit names the abilities, never the secret.
    $audit = json_encode($this->inTenant(fn () => DB::table('audit_events')->where('action', 'like', 'api_client.%')->get()));
    expect($audit)->toContain('api_client.created', 'api_client.token_issued', 'invoices:submit')->and($audit)->not->toContain(explode('|', $res['token'])[1]);
});

it('never lets a token carry approve, wildcard or unknown abilities', function (): void {
    $this->asPerson($this->admin);
    foreach (['invoices:approve', '*', 'journals:reverse', 'periods:write', 'signing:verify', 'invoices'] as $bad) {
        $this->postJson('/api/v1/api-clients', ['name' => 'X', 'company_ids' => [$this->f->companyId], 'abilities' => ['invoices:read', $bad]], $this->key())
            ->assertStatus(422)->assertJsonValidationErrors(['abilities.1']);
    }
    $this->postJson('/api/v1/api-clients', ['name' => 'X', 'company_ids' => [$this->f->companyId], 'abilities' => []], $this->key())->assertStatus(422)->assertJsonValidationErrors(['abilities']);
    $this->postJson('/api/v1/api-clients', ['name' => 'X', 'company_ids' => [], 'abilities' => ['invoices:read']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['company_ids']);
    $this->postJson('/api/v1/api-clients', ['name' => 'X', 'company_ids' => [(string) Str::uuid7()], 'abilities' => ['invoices:read']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['company_ids.0']);
    $this->postJson('/api/v1/api-clients', ['name' => 'X', 'company_ids' => [$this->f->companyId], 'abilities' => ['invoices:read'], 'expires_at' => '2020-01-01T00:00:00Z'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['expires_at']);
    expect(DB::table('api_clients')->count())->toBe(0);
});

it('issues more tokens, revokes the client and stops its tokens at once', function (): void {
    $this->asPerson($this->admin);
    $client = $this->postJson('/api/v1/api-clients', ['name' => 'Sync', 'company_ids' => [$this->f->companyId], 'abilities' => ['contacts:read']], $this->key())->assertCreated()->json('data');
    $second = $this->postJson("/api/v1/api-clients/{$client['id']}/tokens", ['abilities' => ['items:read'], 'token_name' => 'second', 'expires_at' => gmdate('Y-m-d\TH:i:s\Z', time() + 86400)], $this->key())
        ->assertCreated()->assertJsonCount(2, 'data.tokens')->json('data');
    $this->postJson("/api/v1/api-clients/{$client['id']}/tokens", ['name' => 'rename', 'abilities' => ['items:read']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['name']);

    $this->asToken($client['token'])->getJson($this->api('contacts'))->assertOk();
    $this->asToken($second['token'])->getJson($this->api('items'))->assertOk();

    $this->asPerson($this->admin)->postJson("/api/v1/api-clients/{$client['id']}/revoke", [], $this->key())->assertOk()->assertJsonPath('data.is_active', false)->assertJsonCount(0, 'data.tokens');
    $this->postJson("/api/v1/api-clients/{$client['id']}/revoke", [], $this->key())->assertForbidden(); // already revoked: nothing left to do
    $this->postJson("/api/v1/api-clients/{$client['id']}/tokens", ['abilities' => ['items:read']], $this->key())->assertForbidden();
    $this->asToken($client['token'])->getJson($this->api('contacts'))->assertUnauthorized();
    $this->asToken($second['token'])->getJson($this->api('items'))->assertUnauthorized();
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'api_client.revoked')->count()))->toBe(1);
});

it('keeps API client management with people who administer the organisation', function (): void {
    $body = ['name' => 'X', 'company_ids' => [$this->f->companyId], 'abilities' => ['invoices:read']];
    $this->asPerson($this->accountant)->getJson('/api/v1/api-clients')->assertForbidden();
    $this->postJson('/api/v1/api-clients', $body, $this->key())->assertForbidden();
    $this->asPerson($this->owner)->postJson('/api/v1/api-clients', $body, $this->key())->assertForbidden(); // a company Owner is not an organisation admin
    $token = $this->newToken(['invoices:read']);
    $this->asToken($token)->getJson('/api/v1/api-clients')->assertForbidden();
    $this->asToken($token)->postJson('/api/v1/api-clients', $body, $this->key())->assertForbidden();
});
