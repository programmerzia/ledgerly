<?php

declare(strict_types=1);

use App\Models\Platform\User;
use App\Models\Webhooks\WebhookEndpoint;
use App\Support\Tenancy\TenantContext;
use App\Support\Webhooks\WebhookSigner;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;
use Tests\Support\MakesApiCalls;

uses(MakesApiCalls::class);

/*
 * Webhook endpoint management (13 §15, §7): organisation-level, owners and admins, people only. The secret is
 * shown once, on create and on rotate.
 */

const ENDPOINT = ['url' => 'https://hooks.example.test/in', 'events' => ['journal.posted', 'period.closed'], 'description' => 'ERP'];

beforeEach(function (): void {
    $this->setUpWorld();
    $this->owner = User::query()->findOrFail($this->f->userId);
    $this->admin = $this->person('Ada Admin', ['Viewer'], org: 'admin');
    $this->member = $this->person('Mia Member', ['Finance Manager']);
});

it('creates an endpoint and returns the secret once; reads never show it', function (): void {
    $created = $this->asPerson($this->owner)->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())
        ->assertCreated()
        ->assertJsonPath('data.url', ENDPOINT['url'])
        ->assertJsonPath('data.events', ['journal.posted', 'period.closed'])
        ->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.version', 0)
        ->assertJsonPath('data.can.update', true);
    $secret = $created->json('data.secret');
    expect($secret)->toStartWith('whsec_')->and(strlen($secret))->toBeGreaterThan(40);

    $id = $created->json('data.id');
    $this->getJson('/api/v1/webhook-endpoints')->assertOk()->assertJsonPath('data.0.id', $id)->assertJsonMissingPath('data.0.secret');
    expect($this->getJson('/api/v1/webhook-endpoints')->getContent())->not->toContain($secret);
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'webhook_endpoint.created')->count())->toBe(1));
});

it('lets owners and admins manage webhooks, and nobody else: members and API tokens are refused', function (): void {
    $this->asPerson($this->admin)->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertCreated();

    $this->asPerson($this->member)->getJson('/api/v1/webhook-endpoints')->assertForbidden();
    $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertForbidden();

    $token = $this->newToken(['journals:read', 'journals:write']);
    $this->asToken($token)->getJson('/api/v1/webhook-endpoints')->assertForbidden();
    $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertForbidden();
});

it('validates the URL, the event names and the shape of the body', function (): void {
    $this->asPerson($this->owner);
    $post = fn (array $body) => $this->postJson('/api/v1/webhook-endpoints', [...ENDPOINT, ...$body], $this->key());

    $post(['url' => 'ftp://hooks.example.test/x'])->assertStatus(422)->assertJsonValidationErrors(['url']);
    $post(['url' => 'https://127.0.0.1/x'])->assertStatus(422)->assertJsonValidationErrors(['url']);
    $post(['url' => 'https://169.254.169.254/latest'])->assertStatus(422)->assertJsonValidationErrors(['url']);
    $post(['url' => 'https://localhost/x'])->assertStatus(422)->assertJsonValidationErrors(['url']);
    $post(['url' => 'https://u:p@hooks.example.test/x'])->assertStatus(422)->assertJsonValidationErrors(['url']);
    $post(['events' => ['journal.posted', 'nope.nothing']])->assertStatus(422)->assertJsonValidationErrors(['events.1']);
    $post(['events' => []])->assertStatus(422)->assertJsonValidationErrors(['events']);
    $post(['events' => ['*']])->assertCreated();
    $post(['version' => 1])->assertStatus(422)->assertJsonValidationErrors(['version']);
});

it('updates with optimistic locking, rotates the secret, disables and enables', function (): void {
    $this->asPerson($this->owner);
    $created = $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertCreated();
    $id = $created->json('data.id');
    $oldSecret = $created->json('data.secret');

    $this->putJson("/api/v1/webhook-endpoints/{$id}", [...ENDPOINT, 'events' => ['*'], 'url' => 'https://new.example.test/in', 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.events', ['*'])->assertJsonPath('data.url', 'https://new.example.test/in')->assertJsonPath('data.version', 1)->assertJsonMissingPath('data.secret');
    $this->putJson("/api/v1/webhook-endpoints/{$id}", [...ENDPOINT, 'version' => 0], $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict']);
    $this->putJson("/api/v1/webhook-endpoints/{$id}", ENDPOINT, $this->key())->assertStatus(422)->assertJsonValidationErrors(['version']);

    $rotated = $this->postJson("/api/v1/webhook-endpoints/{$id}/rotate-secret", [], $this->key())->assertOk()->assertJsonPath('data.version', 2);
    $newSecret = $rotated->json('data.secret');
    expect($newSecret)->toStartWith('whsec_')->not->toBe($oldSecret);
    $this->inTenant(function () use ($id, $oldSecret, $newSecret): void {
        $stored = WebhookEndpoint::query()->findOrFail($id)->secret;
        $header = WebhookSigner::header($stored, 1_700_000_000, 'x');
        expect($stored)->toBe($newSecret)
            ->and(WebhookSigner::verify($header, 'x', $newSecret, 1_700_000_000))->toBeTrue()
            ->and(WebhookSigner::verify($header, 'x', $oldSecret, 1_700_000_000))->toBeFalse();
    });
    $this->getJson('/api/v1/webhook-endpoints')->assertJsonMissingPath('data.0.secret')->assertJsonPath('data.0.secret_rotated_at', fn ($v) => $v !== null);

    $this->postJson("/api/v1/webhook-endpoints/{$id}/disable", [], $this->key())->assertOk()
        ->assertJsonPath('data.is_active', false)->assertJsonPath('data.disabled_reason', 'manual')->assertJsonPath('data.can.redeliver', false);
    $this->postJson("/api/v1/webhook-endpoints/{$id}/enable", [], $this->key())->assertOk()
        ->assertJsonPath('data.is_active', true)->assertJsonPath('data.disabled_reason', null);
    $this->inTenant(fn () => expect(DB::table('audit_events')->whereIn('action', ['webhook_endpoint.updated', 'webhook_endpoint.secret_rotated', 'webhook_endpoint.disabled', 'webhook_endpoint.enabled'])->count())->toBe(4));
});

it('lists deliveries newest first by cursor and redelivers a finished one', function (): void {
    $this->asPerson($this->owner);
    $id = $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->json('data.id');
    $this->inTenant(function (): void {
        cashSale($this->f);
        cashSale($this->f, 2500);
        cashSale($this->f, 4000);
    });
    $this->asPerson($this->owner);

    $page = $this->getJson("/api/v1/webhook-endpoints/{$id}/deliveries?limit=2")->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.limit', 2);
    $ids = array_column($page->json('data'), 'id');
    expect($ids)->toBe([...$ids])->and($ids[0])->toBeGreaterThan($ids[1]);
    $cursor = $page->json('meta.next_cursor');
    $next = $this->getJson("/api/v1/webhook-endpoints/{$id}/deliveries?limit=2&cursor={$cursor}")->assertOk()->assertJsonCount(1, 'data');
    expect($next->json('data.0.id'))->toBeLessThan($ids[1]);
    $this->getJson("/api/v1/webhook-endpoints/{$id}/deliveries?status=delivered")->assertOk()->assertJsonCount(0, 'data');
    $this->getJson("/api/v1/webhook-endpoints/{$id}/deliveries?cursor=garbage")->assertStatus(422);

    // A pending delivery cannot be redelivered; a failed one can, with a fresh window.
    $this->postJson("/api/v1/webhook-endpoints/{$id}/deliveries/{$ids[0]}/redeliver", [], $this->key())->assertStatus(422)->assertJson(['code' => 'webhook_delivery_pending']);
    $this->inTenant(fn () => DB::table('webhook_deliveries')->where('id', $ids[0])->update(['status' => 'failed', 'attempts' => 9, 'next_retry_at' => null, 'response_code' => 500, 'error' => 'x']));
    $this->postJson("/api/v1/webhook-endpoints/{$id}/deliveries/{$ids[0]}/redeliver", [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.attempts', 0)->assertJsonPath('data.response_code', null)->assertJsonPath('data.error', null);
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'webhook_delivery.redelivered')->count())->toBe(1));

    // Not once the endpoint is disabled.
    $this->postJson("/api/v1/webhook-endpoints/{$id}/disable", [], $this->key())->assertOk();
    $this->postJson("/api/v1/webhook-endpoints/{$id}/deliveries/{$ids[1]}/redeliver", [], $this->key())->assertForbidden();
});

it('hides other organisations\' endpoints and deliveries behind 404, and a delivery under the wrong endpoint', function (): void {
    $this->asPerson($this->owner);
    $mine = $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->json('data.id');
    $other = $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->json('data.id');
    $this->inTenant(fn () => cashSale($this->f));
    $this->asPerson($this->owner);
    $delivery = $this->getJson("/api/v1/webhook-endpoints/{$mine}/deliveries")->json('data.0.id');

    // The delivery belongs to $mine only: asking for it through $other finds nothing.
    $this->postJson("/api/v1/webhook-endpoints/{$other}/deliveries/{$delivery}/redeliver", [], $this->key())->assertNotFound();

    // Another organisation sees none of it.
    $second = LedgerFixture::create(slug: 'beta');
    DB::table('users')->insert(['id' => $uid = (string) Str::uuid7(), 'name' => 'Bea Beta', 'email' => 'bea@beta.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $second->tenantId, 'user_id' => $uid, 'role' => 'owner']);
    app(TenantContext::class)->clear();
    $this->flushSession();
    $this->sessionId = Str::random(40); // a fresh browser session for the other organisation's owner
    $this->asPerson(User::query()->findOrFail($uid));
    $this->getJson('/api/v1/webhook-endpoints')->assertOk()->assertJsonCount(0, 'data');
    $this->putJson("/api/v1/webhook-endpoints/{$mine}", [...ENDPOINT, 'version' => 0], $this->key())->assertNotFound();
    $this->postJson("/api/v1/webhook-endpoints/{$mine}/rotate-secret", [], $this->key())->assertNotFound();
    $this->postJson("/api/v1/webhook-endpoints/{$mine}/disable", [], $this->key())->assertNotFound();
    $this->getJson("/api/v1/webhook-endpoints/{$mine}/deliveries")->assertNotFound();
    $this->postJson("/api/v1/webhook-endpoints/{$mine}/deliveries/{$delivery}/redeliver", [], $this->key())->assertNotFound();
});

it('caps the number of endpoints per organisation', function (): void {
    config(['webhooks.max_endpoints' => 2]);
    $this->asPerson($this->owner);
    $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertCreated();
    $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertCreated();
    $this->postJson('/api/v1/webhook-endpoints', ENDPOINT, $this->key())->assertStatus(422)->assertJson(['code' => 'webhook_limit_reached']);
});
