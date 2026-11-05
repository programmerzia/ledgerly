<?php

declare(strict_types=1);

use App\Actions\Webhooks\Inputs\WebhookEndpointInput;
use App\Actions\Webhooks\ManageWebhookEndpoint;
use App\Contracts\HostResolver;
use App\Events\Procurement\ProcurementEvent;
use App\Events\Transactions\TransactionEvent;
use App\Jobs\Webhooks\DeliverWebhook;
use App\Models\Platform\User;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use App\Notifications\WebhookEndpointDisabledNotification;
use App\Support\Outbox\OutboxMessage;
use App\Support\Outbox\WebhookOutboxHandler;
use App\Support\Tenancy\TenantContext;
use App\Support\Webhooks\SsrfGuard;
use App\Support\Webhooks\WebhookDeliverer;
use App\Support\Webhooks\WebhookEvents;
use App\Support\Webhooks\WebhookSigner;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Tests\Support\FakeHostResolver;
use Tests\Support\LedgerFixture;

/*
 * Webhooks over the outbox (13 §15): idempotent fan-out, signed delivery with a pinned connection, back-off and
 * auto-disable on the frozen clock, 410, redirects, rebinding, and tenant isolation. Http::fake only; no network.
 */

const HOOK_URL = 'https://hooks.example.test/in';

beforeEach(function (): void {
    $this->dns = (new FakeHostResolver)->script('hooks.example.test', [['93.184.216.34']]);
    $this->app->instance(HostResolver::class, $this->dns);
    $this->app->instance(SsrfGuard::class, new SsrfGuard($this->dns, allowHttp: false));
    Http::preventStrayRequests();
});

function hook(LedgerFixture $f, array $events = ['journal.posted'], string $url = HOOK_URL): WebhookEndpoint
{
    return app(ManageWebhookEndpoint::class)->create($f->actor, new WebhookEndpointInput($url, $events, 'ERP'));
}

/** @return list<WebhookDelivery> */
function deliveries(): array
{
    return WebhookDelivery::query()->orderBy('id')->get()->all();
}

function send(LedgerFixture $f, WebhookDelivery $d): WebhookDelivery
{
    app(TenantContext::class)->run($f->tenantId, fn () => app(WebhookDeliverer::class)->deliver($f->tenantId, $d->id));

    return WebhookDelivery::query()->findOrFail($d->id);
}

it('turns an outbox message into one signed, pinned, redirect-free POST that carries the event envelope', function (): void {
    $f = LedgerFixture::create();
    $endpoint = hook($f);
    $secret = $endpoint->secret;
    $journal = cashSale($f);

    [$delivery] = deliveries();
    expect($delivery->status)->toBe('pending')->and($delivery->event_type)->toBe('journal.posted');

    $seen = [];
    Http::fake(function (Request $request, array $options) use (&$seen) {
        $seen[] = [$request, $options];

        return Http::response('{"ok":true}', 200);
    });
    $sent = send($f, $delivery);

    expect($sent->status)->toBe('delivered')->and($sent->attempts)->toBe(1)->and($sent->response_code)->toBe(200)
        ->and($sent->response_snippet)->toBe('{"ok":true}')->and($sent->next_retry_at)->toBeNull();
    expect($seen)->toHaveCount(1);
    [$request, $options] = $seen[0];

    // Signature: recomputed from the secret, the timestamp and the exact bytes received.
    $body = $request->body();
    $header = $request->header('X-Ledgerly-Signature')[0];
    preg_match('/^t=(\d+),v1=([0-9a-f]{64})$/', $header, $m);
    expect((int) $m[1])->toBe($this->clock->now()->getTimestamp())
        ->and($m[2])->toBe(hash_hmac('sha256', $m[1].'.'.$body, $secret))
        ->and(WebhookSigner::verify($header, $body, $secret, $this->clock->now()->getTimestamp()))->toBeTrue();

    $payload = json_decode($body, true);
    expect($request->url())->toBe(HOOK_URL)
        ->and($request->method())->toBe('POST')
        ->and($request->header('X-Ledgerly-Event')[0])->toBe('journal.posted')
        ->and($payload['event_id'])->toBe($delivery->message_id)
        ->and($request->header('X-Ledgerly-Event-Id')[0])->toBe($delivery->message_id)
        ->and($payload['type'])->toBe('journal.posted')
        ->and($payload['occurred_at'])->toMatch('/^2026-03-15T09:30:00\.\d{6}Z$/')
        ->and($payload['data']['resource'])->toEqual(['type' => 'journal', 'id' => $journal->id, 'version' => $payload['data']['version']])
        ->and($payload['data']['company_id'])->toBe($f->companyId);

    // Pinned to the validated address, no redirects, no proxy, short timeouts.
    expect($options['allow_redirects'])->toBeFalse()
        ->and($options['curl'][CURLOPT_RESOLVE])->toBe(['hooks.example.test:443:93.184.216.34'])
        ->and($options['curl'][CURLOPT_PROXY])->toBe('')
        ->and($options['connect_timeout'])->toBe(5)
        ->and($options['timeout'])->toBe(10);
    expect($this->dns->lookups['hooks.example.test'])->toBe(1);
});

it('is idempotent by message id: replaying the outbox message never creates a second delivery', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    config(['queue.default' => 'redis']);
    Queue::fake([DeliverWebhook::class]);

    $message = new OutboxMessage((string) Str::uuid7(), $f->tenantId, 'journal.posted', ['journal_id' => (string) Str::uuid7(), 'company_id' => $f->companyId, 'version' => 2], '2026-03-15 09:30:00.123456+00', 1);
    $handler = app(WebhookOutboxHandler::class);
    $handler->handle($message);
    $handler->handle($message);
    $handler->handle($message);

    expect(deliveries())->toHaveCount(1);
    Queue::assertPushed(DeliverWebhook::class, 1);
    Queue::assertPushed(DeliverWebhook::class, fn (DeliverWebhook $j) => $j->queue === 'webhooks');
    expect(DB::table('webhook_deliveries')->where('message_id', $message->id)->count())->toBe(1);
});

it('delivers only to active endpoints that subscribe to the type, and `*` subscribes to everything', function (): void {
    $f = LedgerFixture::create();
    $posted = hook($f, ['journal.posted']);
    hook($f, ['period.closed']);
    $all = hook($f, ['*']);
    $off = hook($f, ['journal.posted']);
    app(ManageWebhookEndpoint::class)->disable($f->actor, $off->id);

    cashSale($f);

    expect(array_map(fn ($d) => $d->endpoint_id, deliveries()))->toEqualCanonicalizing([$posted->id, $all->id]);
});

it('does not queue the job on the sync queue; the sweep picks the row up', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    Queue::fake([DeliverWebhook::class]);
    cashSale($f);
    Queue::assertNotPushed(DeliverWebhook::class);

    app(TenantContext::class)->clear();
    $this->artisan('webhooks:sweep')->assertSuccessful();
    Queue::assertPushed(DeliverWebhook::class, 1);
    Queue::assertPushed(DeliverWebhook::class, fn (DeliverWebhook $j) => $j->queue === 'webhooks');
});

it('sweeps only due deliveries of active endpoints, across tenants', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    hook($a);
    cashSale($a);
    $b = LedgerFixture::create(slug: 'beta');
    $off = hook($b);
    cashSale($b);
    app(ManageWebhookEndpoint::class)->disable($b->actor, $off->id);
    $c = LedgerFixture::create(slug: 'gamma');
    hook($c);
    cashSale($c);
    DB::table('webhook_deliveries')->update(['next_retry_at' => '2026-03-15 09:45:00+00']); // c is later; a and b follow below
    app(TenantContext::class)->run($a->tenantId, fn () => DB::table('webhook_deliveries')->update(['next_retry_at' => '2026-03-15 09:00:00+00']));

    app(TenantContext::class)->clear();
    Queue::fake();
    $this->artisan('webhooks:sweep')->assertSuccessful();

    Queue::assertPushed(DeliverWebhook::class, 1);
    Queue::assertPushed(DeliverWebhook::class, fn (DeliverWebhook $j) => $j->tenantId() === $a->tenantId);
});

it('retries a failing delivery with back-off, then auto-disables the endpoint after 24 hours with an audit event and an owner notification', function (): void {
    Notification::fake();
    $f = LedgerFixture::create();
    $endpoint = hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    Http::fake(['hooks.example.test/*' => Http::response('boom', 500)]);

    $start = $this->clock->now();
    $waits = [];
    for ($i = 0; $i < 40; $i++) {
        $delivery = send($f, $delivery);
        if ($delivery->status !== 'pending') {
            break;
        }
        expect($delivery->response_code)->toBe(500)->and($delivery->attempts)->toBe($i + 1);
        $waits[] = $delivery->next_retry_at->getTimestamp() - $this->clock->now()->getTimestamp();
        // Not yet due: a sweep or job a second early does nothing.
        $this->clock->advance('+'.($waits[$i] - 1).' seconds');
        $before = $delivery->attempts;
        expect(send($f, $delivery)->attempts)->toBe($before);
        $this->clock->advance('+1 second');
    }

    // Exponential growth within ±20 %, capped at 4 h.
    foreach ([0, 1, 2, 3] as $n) {
        expect($waits[$n])->toBeBetween((int) (60 * 2 ** $n * 0.8), (int) ceil(60 * 2 ** $n * 1.2));
    }
    expect(max($waits))->toBeLessThanOrEqual(14_400 * 1.2 + 1);

    expect($delivery->status)->toBe('failed')->and($delivery->next_retry_at)->toBeNull()
        ->and($delivery->last_attempt_at->getTimestamp())->toBe($start->modify('+24 hours')->getTimestamp());
    $endpoint->refresh();
    expect($endpoint->is_active)->toBeFalse()->and($endpoint->disabled_reason)->toBe('failures');

    $audit = DB::table('audit_events')->where('action', 'webhook_endpoint.auto_disabled')->first();
    expect($audit)->not->toBeNull()->and($audit->subject_id)->toBe($endpoint->id)
        ->and($audit->actor_type)->toBe('system')
        ->and(json_encode($audit))->not->toContain($endpoint->secret);
    Notification::assertSentTo(User::query()->findOrFail($f->userId), WebhookEndpointDisabledNotification::class, fn ($n) => $n->host === 'hooks.example.test' && $n->reason === 'failures');
    Notification::assertCount(1);
});

it('cancels the other pending deliveries when the endpoint is auto-disabled, and sends nothing more', function (): void {
    $f = LedgerFixture::create();
    $endpoint = hook($f);
    cashSale($f);
    cashSale($f, 5000);
    [$first, $second] = deliveries();
    Http::fake(['hooks.example.test/*' => Http::response('gone', 410)]);

    $first = send($f, $first);

    expect($first->status)->toBe('failed')->and($first->error)->toBe('gone')->and($first->attempts)->toBe(1);
    expect(WebhookDelivery::query()->findOrFail($second->id)->status)->toBe('cancelled');
    $endpoint->refresh();
    expect($endpoint->is_active)->toBeFalse()->and($endpoint->disabled_reason)->toBe('gone');
    Http::assertSentCount(1);

    // The cancelled delivery is not sent even if someone forces the job.
    expect(send($f, WebhookDelivery::query()->findOrFail($second->id))->status)->toBe('cancelled');
    Http::assertSentCount(1);
});

it('delivers on a later retry and then stops retrying', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    Http::fakeSequence('hooks.example.test/*')->push('', 503)->push('', 502)->push('fine', 204);

    $delivery = send($f, $delivery);
    expect($delivery->status)->toBe('pending');
    $this->clock->advance('+2 minutes');
    $delivery = send($f, $delivery);
    expect($delivery->status)->toBe('pending')->and($delivery->attempts)->toBe(2);
    $this->clock->advance('+5 minutes');
    $delivery = send($f, $delivery);

    expect($delivery->status)->toBe('delivered')->and($delivery->attempts)->toBe(3)->and($delivery->response_code)->toBe(204)
        ->and($delivery->delivered_at)->not->toBeNull()->and($delivery->next_retry_at)->toBeNull();
    $this->clock->advance('+1 day');
    send($f, $delivery);
    Http::assertSentCount(3);
});

it('does not follow redirects: a 302 to the metadata address is a failed attempt and nothing else is requested', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    $seen = [];
    Http::fake(function (Request $request, array $options) use (&$seen) {
        $seen[] = [$request->url(), $options['allow_redirects']];

        return Http::response('', 302, ['Location' => 'http://169.254.169.254/latest/meta-data/']);
    });

    $delivery = send($f, $delivery);

    expect($seen)->toBe([[HOOK_URL, false]])
        ->and($delivery->status)->toBe('pending')->and($delivery->response_code)->toBe(302)
        ->and($delivery->error)->toBe('redirect_not_followed')->and($delivery->next_retry_at)->not->toBeNull();
    Http::assertSentCount(1);
});

it('refuses hosts that resolve inside the network and sends nothing', function (string $address): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    $this->dns->script('hooks.example.test', [[$address]]);
    Http::fake();

    $delivery = send($f, $delivery);

    Http::assertNothingSent();
    expect($delivery->status)->toBe('pending')->and($delivery->error)->toBe('blocked:blocked_address')
        ->and($delivery->response_code)->toBeNull()->and($delivery->next_retry_at)->not->toBeNull();
})->with(['10.0.0.5', '127.0.0.1', '169.254.169.254', '100.64.1.1', '::1', 'fd00::1', '::ffff:192.168.0.1']);

it('survives DNS rebinding: it resolves once and connects to the checked address, and a later private answer is refused', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    // First lookup: public. Any lookup after that: the internal address an attacker would swap in.
    $this->dns->script('hooks.example.test', [['93.184.216.34'], ['169.254.169.254']]);
    $pins = [];
    Http::fake(function (Request $request, array $options) use (&$pins) {
        $pins[] = $options['curl'][CURLOPT_RESOLVE];

        return Http::response('', 500);
    });

    $delivery = send($f, $delivery);
    expect($pins)->toBe([['hooks.example.test:443:93.184.216.34']])
        ->and($this->dns->lookups['hooks.example.test'])->toBe(1);

    $this->clock->advance('+3 minutes');
    $delivery = send($f, $delivery);

    expect($pins)->toHaveCount(1) // the second attempt never connected
        ->and($delivery->error)->toBe('blocked:blocked_address');
    Http::assertSentCount(1);
});

it('records timeouts as short error codes and caps the stored response snippet', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    cashSale($f, 700);
    [$one, $two] = deliveries();
    Http::fake(fn () => throw new ConnectionException('cURL error 28: Operation timed out after 10001 milliseconds with 0 bytes received'));
    expect(send($f, $one)->error)->toBe('timeout');

    Http::fake(['hooks.example.test/*' => Http::response(str_repeat('é', 5000)."\0".str_repeat('x', 100), 500)]);
    $two = send($f, $two);
    expect(strlen((string) $two->response_snippet))->toBeLessThanOrEqual(512);
    expect(mb_check_encoding((string) $two->response_snippet, 'UTF-8'))->toBeTrue();
});

it('runs as a tenant-aware job on the webhooks queue and refuses to start inside a leaked context', function (): void {
    $f = LedgerFixture::create();
    hook($f);
    cashSale($f);
    [$delivery] = deliveries();
    Http::fake(['hooks.example.test/*' => Http::response('ok', 200)]);

    $job = new DeliverWebhook($f->tenantId, $delivery->id);
    expect($job->queue)->toBe('webhooks')->and($job->tenantId())->toBe($f->tenantId)->and($job->tries)->toBe(1);

    expect(fn () => DeliverWebhook::dispatchSync($f->tenantId, $delivery->id))->toThrow(LogicException::class, 'still set');

    app(TenantContext::class)->clear();
    DeliverWebhook::dispatchSync($f->tenantId, $delivery->id);
    expect(app(TenantContext::class)->id())->toBeNull();
    app(TenantContext::class)->run($f->tenantId, fn () => expect(WebhookDelivery::query()->findOrFail($delivery->id)->status)->toBe('delivered'));
});

it('isolates tenants: another organisation\'s endpoint never receives this event, and rows are invisible across tenants', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    $endpointA = hook($a, ['*']);
    $b = LedgerFixture::create(slug: 'beta');
    $endpointB = hook($b, ['*'], 'https://other.example.test/hook');

    app(TenantContext::class)->run($a->tenantId, fn () => cashSale($a));

    $contextA = app(TenantContext::class);
    $contextA->run($b->tenantId, function () use ($endpointB): void {
        expect(WebhookDelivery::query()->count())->toBe(0)
            ->and(WebhookEndpoint::query()->pluck('id')->all())->toBe([$endpointB->id]);
    });
    $contextA->run($a->tenantId, function () use ($endpointA, $endpointB): void {
        expect(WebhookDelivery::query()->pluck('endpoint_id')->all())->toBe([$endpointA->id])
            ->and(WebhookEndpoint::query()->find($endpointB->id))->toBeNull();
    });

    // Handing the handler another tenant's message inside this tenant's context is refused.
    $foreign = new OutboxMessage((string) Str::uuid7(), $b->tenantId, 'journal.posted', [], '2026-03-15 09:30:00+00', 1);
    $contextA->run($a->tenantId, fn () => expect(fn () => app(WebhookOutboxHandler::class)->handle($foreign))->toThrow(LogicException::class));
});

it('keeps the signing secret encrypted at rest and out of audit rows', function (): void {
    $f = LedgerFixture::create();
    $endpoint = hook($f);

    $raw = (string) DB::table('webhook_endpoints')->where('id', $endpoint->id)->value('secret');
    expect($raw)->not->toContain($endpoint->secret)->and(decrypt($raw, false))->toBe($endpoint->secret)
        ->and($endpoint->secret)->toStartWith('whsec_');
    expect(json_encode(DB::table('audit_events')->where('subject_id', $endpoint->id)->get()))->not->toContain($endpoint->secret);
});

it('registers the webhook handler for every subscribable event type', function (): void {
    foreach (WebhookEvents::TYPES as $type) {
        expect(config('outbox.handlers')[$type])->toContain(WebhookOutboxHandler::class); // other handlers (practice KPIs) may share the type
    }
    expect(WebhookEvents::subscribable())->toContain('*', 'journal.posted', 'period.closed', 'document.approved');
});

it('offers every domain event for subscription, so a new event cannot silently never be delivered', function (): void {
    $types = [];
    foreach (File::allFiles(app_path('Events')) as $file) {
        $source = (string) file_get_contents($file->getPathname());
        if ($file->getFilename() === 'ProcurementEvent.php') {
            $types = [...$types, ...ProcurementEvent::TYPES];
        } elseif ($file->getFilename() === 'TransactionEvent.php') {
            $types = [...$types, ...TransactionEvent::TYPES];
        } elseif (preg_match("/function type\\(\\): string\\s*\\{\\s*return '([a-z_.]+)';/", $source, $m) === 1) {
            $types[] = $m[1];
        } elseif (preg_match("/'document\\.'\\.strtolower\\('(\\w+)'\\)/", $source, $m) === 1) {
            $types[] = 'document.'.strtolower($m[1]);
        } elseif (preg_match("/documentType\\.'\\.(\\w+)'/", $source, $m) === 1) {
            $types[] = 'invoice.'.$m[1];
            $types[] = 'bill.'.$m[1];
        } else {
            $this->fail("Cannot read the event type of {$file->getFilename()}.");
        }
    }
    expect($types)->not->toBeEmpty()->and(array_values(array_diff($types, WebhookEvents::TYPES)))->toBe([]);
});
