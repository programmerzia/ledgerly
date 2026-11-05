<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use App\Domain\Documents\ShareToken;
use App\Models\Sharing\InvoiceShareLink;
use App\Services\Sharing\InvoiceLinkAccess;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\FakePdfEngine;
use Tests\Support\LedgerFixture;

/*
 * Online invoice links (plan 3c.7b): an unguessable token stored only as a hash, revocable and optionally expiring, a public page
 * that shows one invoice and nothing else, found without a tenant in the address and read with row-level security on.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    app()->instance(HtmlToPdf::class, new FakePdfEngine);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->customer)->update(['email' => 'billing@c1.example']));
    $this->doc = $this->sale(5000);
    $this->link = fn (?array $body = null, $doc = null) => $this->asPerson($this->accountant)->postJson($this->api('invoices/'.($doc ?? $this->doc)['id'].'/share-links'), $body ?? [], $this->key());
    /** The token of a fresh link. */
    $this->token = fn ($doc = null): string => basename((string) ($this->link)(null, $doc)->assertCreated()->json('data.url'));
    /** A request from a stranger: no session, no cookies, no headers of ours. */
    $this->stranger = function (string $path) {
        app(TenantContext::class)->clear();
        app('auth')->forgetGuards();
        $this->flushHeaders();
        $this->flushSession();
        $this->defaultCookies = [];
        $this->unencryptedCookies = [];
        $this->serverVariables = [];

        return $this->getJson('/api/v1/public/'.$path);
    };
});

it('makes a link on a posted invoice, shows the address once, and stores only a hash of a 256-bit token', function (): void {
    $made = ($this->link)(['expires_in_days' => 30])->assertCreated()->assertJsonPath('data.status', 'active')->assertJsonPath('data.channel', 'manual')->json('data');
    $token = basename($made['url']);

    expect($made['url'])->toBe(rtrim((string) config('app.frontend_url'), '/').'/i/'.$token)
        ->and($token)->toHaveLength(43)->and(ShareToken::wellFormed($token))->toBeTrue()
        ->and(strlen((string) base64_decode(strtr($token, '-_', '+/').'=')))->toBe(32)
        ->and($made['expires_at'])->not->toBeNull();
    $row = $this->inTenant(fn () => DB::table('invoice_share_links')->first());
    expect($row->token_hash)->toBe(hash('sha256', $token))->and($row->token_hash)->not->toContain($token);
    expect(json_encode($this->inTenant(fn () => DB::table('invoice_share_links')->get()->all())))->not->toContain($token);

    // The list never carries the address.
    $list = $this->asPerson($this->viewer)->getJson($this->api("invoices/{$this->doc['id']}/share-links"))->assertOk()->assertJsonCount(1, 'data');
    expect(json_encode($list->json()))->not->toContain($token)->and($list->json('data.0'))->not->toHaveKey('url')->not->toHaveKey('token_hash');
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'invoice.link_created')->count())->toBe(1));
});

it('refuses a link for a draft, a credit note, a bill, and for people without documents.share', function (): void {
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    ($this->link)(null, $draft)->assertStatus(422)->assertJson(['code' => 'link_not_available']);
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', 'VAT10', '0', '5000']]));
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$bill['id']}/share-links"), [], $this->key())->assertNotFound();
    $this->asPerson($this->viewer)->postJson($this->api("invoices/{$this->doc['id']}/share-links"), [], $this->key())->assertForbidden();
    $token = $this->newToken(['invoices:read', 'invoices:write']);
    $this->asToken($token)->postJson($this->api("invoices/{$this->doc['id']}/share-links"), [], $this->key())->assertForbidden();
    ($this->link)(['expires_in_days' => 0])->assertStatus(422);
    ($this->link)(['expires_in_days' => 400])->assertStatus(422);
});

it('shows the invoice, its status and balance, and payment instructions, with nothing else', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('settings'), ['payment_instructions' => 'Pay to IBAN 123'], $this->key())->assertOk();
    $token = ($this->token)();

    $res = ($this->stranger)("invoices/{$token}")->assertOk();
    $data = $res->json('data');
    expect(array_keys($data))->toBe(['company_name', 'bill_to', 'number', 'issue_date', 'due_date', 'currency', 'status', 'balance_due', 'subtotal', 'tax_total', 'total', 'lines', 'payment_instructions'])
        ->and($data['number'])->toBe($this->doc['number'])->and($data['status'])->toBe('open')
        ->and($data['balance_due'])->toBe(['amount' => 5500, 'currency' => 'USD'])->and($data['payment_instructions'])->toBe('Pay to IBAN 123')
        ->and($data['bill_to'])->toBe('Contact C1')->and($data['lines'])->toHaveCount(1);
    // No contact details, accounts, ids or tenant anywhere in the body.
    $body = (string) $res->getContent();
    expect($body)->not->toContain('billing@c1.example')->not->toContain($this->f->tenantId)->not->toContain($this->f->companyId)->not->toContain($this->doc['id']);
    $res->assertHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')->assertHeader('Referrer-Policy', 'no-referrer');
    expect($res->headers->get('Cache-Control'))->toContain('no-store');

    // Paid in full: paid, nothing owed.
    $this->postedSettlement('receipt', $this->t->customer, 5500, [[$this->doc['id'], 5500]]);
    $paid = ($this->stranger)("invoices/{$token}")->assertOk()->json('data');
    expect($paid['status'])->toBe('paid')->and($paid['balance_due']['amount'])->toBe(0);
});

it('shows a reversed invoice as reversed with no balance', function (): void {
    $token = ($this->token)();
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$this->doc['id']}/reverse"), ['reason' => 'Wrong customer', 'date' => '2026-03-20'], $this->key())->assertOk();
    ($this->stranger)("invoices/{$token}")->assertOk()->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.balance_due', null);
});

it('answers the same 404 for an unknown, malformed, revoked or expired token', function (): void {
    $revoked = ($this->token)();
    $made = ($this->link)(null)->assertCreated()->json('data');
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$this->doc['id']}/share-links/{$made['id']}/revoke"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'revoked');
    $revokedToken = basename($made['url']);
    $expires = basename((string) ($this->link)(['expires_in_days' => 1])->json('data.url'));

    ($this->stranger)("invoices/{$revoked}")->assertOk();
    ($this->stranger)("invoices/{$expires}")->assertOk();
    $this->clock->advance('+2 days');
    $bodies = [];
    foreach ([$revokedToken, $expires, ShareToken::generate(), 'short', str_repeat('a', 43), str_repeat('!', 43), str_repeat('a', 400)] as $t) {
        $res = ($this->stranger)("invoices/{$t}")->assertNotFound()->assertJson(['code' => 'link_not_found']);
        $res->assertHeader('Referrer-Policy', 'no-referrer');
        $bodies[] = preg_replace('/"request_id":"[^"]*"/', '', (string) $res->getContent());
    }
    expect(array_unique($bodies))->toHaveCount(1);
    ($this->stranger)("invoices/{$revoked}")->assertOk();
});

it('reaches only its own invoice, even when the same tenant has others, and reads under row-level security', function (): void {
    $other = $this->sale(7000);
    $t1 = ($this->token)();
    $t2 = ($this->token)($other);
    expect(($this->stranger)("invoices/{$t1}")->json('data.number'))->toBe($this->doc['number'])
        ->and(($this->stranger)("invoices/{$t2}")->json('data.number'))->toBe($other['number']);

    // Another tenant exists; its context cannot read this tenant's links, whatever the application asks for.
    $beta = LedgerFixture::create('USD', 'beta');
    $visible = $this->inTenant(fn () => InvoiceShareLink::query()->count());
    expect($visible)->toBe(2);
    // Without a tenant context the app role sees no link rows at all (RLS), yet the narrow function still finds one by hash.
    app(TenantContext::class)->clear();
    expect(DB::table('invoice_share_links')->count())->toBe(0)
        ->and(DB::select('SELECT * FROM sysops.invoice_link_by_token_hash(?)', [ShareToken::hash($t1)]))->toHaveCount(1)
        ->and(DB::select('SELECT * FROM sysops.invoice_link_by_token_hash(?)', [ShareToken::hash('nope')]))->toBe([]);
    $row = (array) DB::selectOne('SELECT * FROM sysops.invoice_link_by_token_hash(?)', [ShareToken::hash($t1)]);
    expect(array_keys($row))->toBe(['link_id', 'tenant_id']);
    // And another tenant's context cannot read this tenant's link by its id.
    $linkId = $row['link_id'];
    app(TenantContext::class)->run($beta->tenantId, fn () => expect(InvoiceShareLink::query()->find($linkId))->toBeNull());
});

it('does not open a link when a tenant context is already set, or when the tenant is closed', function (): void {
    $token = ($this->token)();
    $access = app(InvoiceLinkAccess::class);
    app(TenantContext::class)->clear();
    expect($access->open($token, fn () => 'ran'))->toBe('ran');
    app(TenantContext::class)->run($this->f->tenantId, fn () => expect($access->open($token, fn () => 'ran'))->toBeNull());
    DB::table('tenants')->where('id', $this->f->tenantId)->update(['lifecycle' => 'cancelled']);
    expect($access->open($token, fn () => 'ran'))->toBeNull();
});

it('logs each opening without keeping the address, and counts them on the link', function (): void {
    $token = ($this->token)();
    ($this->stranger)("invoices/{$token}")->assertOk();
    ($this->stranger)("invoices/{$token}")->assertOk();

    $this->inTenant(function (): void {
        $views = DB::table('invoice_link_views')->get();
        expect($views)->toHaveCount(2)->and($views->pluck('kind')->unique()->all())->toBe(['page'])
            ->and($views[0]->viewer_hash)->toHaveLength(64)->and($views[0]->viewer_hash)->not->toContain('127.0.0.1')
            ->and(DB::table('invoice_share_links')->value('view_count'))->toBe(2);
    });
    $row = $this->asPerson($this->accountant)->getJson($this->api("invoices/{$this->doc['id']}/share-links"))->assertOk()->json('data.0');
    expect($row['view_count'])->toBe(2)->and($row['last_viewed_at'])->not->toBeNull();
});

it('limits the public page by address', function (): void {
    $token = ($this->token)();
    RateLimiter::clear('public-invoice:127.0.0.1');
    for ($i = 0; $i < 60; $i++) {
        ($this->stranger)("invoices/{$token}")->assertOk();
    }
    ($this->stranger)("invoices/{$token}")->assertStatus(429);
});

it('makes the PDF on the worker, then serves it, and logs the download', function (): void {
    $token = ($this->token)();
    ($this->stranger)("invoices/{$token}/pdf")->assertStatus(202)->assertJsonPath('data.status', 'queued');
    $file = ($this->stranger)("invoices/{$token}/pdf")->assertOk();
    expect($file->headers->get('Content-Type'))->toContain('application/pdf')->and($file->headers->get('X-Robots-Tag'))->toContain('noindex')
        ->and($file->streamedContent())->toStartWith('%PDF');
    $this->inTenant(fn () => expect(DB::table('invoice_link_views')->where('kind', 'pdf')->count())->toBe(1));
    ($this->stranger)('invoices/'.ShareToken::generate().'/pdf')->assertNotFound();
});

it('puts a link in the email only when the message asks for it, expires it, and keeps no working address in the send log', function (): void {
    $plain = $this->asPerson($this->accountant)->postJson($this->api("invoices/{$this->doc['id']}/emails"), ['recipients' => ['billing@c1.example'], 'subject' => 'Your invoice', 'body' => 'Hello'], $this->key())->assertStatus(202);
    $this->inTenant(fn () => expect(DB::table('invoice_share_links')->count())->toBe(0));

    $this->clock->advance('+1 minute');
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$this->doc['id']}/emails"), [
        'recipients' => ['billing@c1.example'], 'subject' => 'Your invoice', 'body' => "View it online: {{ invoice_link }}\nThanks",
    ], $this->key())->assertStatus(202);

    $link = $this->inTenant(fn () => DB::table('invoice_share_links')->first());
    expect($link->channel)->toBe('email')->and($link->expires_at)->not->toBeNull();
    $mails = array_map(fn ($m) => $m->getOriginalMessage(), app('mailer')->getSymfonyTransport()->messages()->all());
    expect($mails)->toHaveCount(2);
    preg_match('~/i/([A-Za-z0-9_-]{43})~', (string) $mails[1]->getTextBody(), $m);
    expect($m)->toHaveCount(2)->and(hash('sha256', $m[1]))->toBe($link->token_hash);
    // The recipient can open it; the log shows that a link went out but not the address.
    ($this->stranger)("invoices/{$m[1]}")->assertOk()->assertJsonPath('data.number', $this->doc['number']);
    $log = $this->inTenant(fn () => DB::table('document_sends')->orderBy('queued_at')->get());
    expect($log[1]->body)->toContain('[online link]')->not->toContain($m[1]);
    $this->clock->advance('+91 days');
    ($this->stranger)("invoices/{$m[1]}")->assertNotFound();
});

it('offers the placeholder in the draft and refuses it for a person without documents.share', function (): void {
    $this->asPerson($this->accountant)->getJson($this->api("invoices/{$this->doc['id']}/email-draft"))->assertOk();
    $this->inTenant(function (): void {
        $role = DB::table('roles')->where('name', 'Sales Assistant')->value('id');
        DB::table('role_has_permissions')->where('role_id', $role)->whereIn('permission_id', DB::table('permissions')->where('name', 'documents.share')->pluck('id'))->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    });
    $this->asPerson($this->assistant)->postJson($this->api("invoices/{$this->doc['id']}/emails"), [
        'recipients' => ['billing@c1.example'], 'subject' => 'Hi', 'body' => '{{ invoice_link }}',
    ], $this->key())->assertForbidden();
    $this->inTenant(fn () => expect(DB::table('invoice_share_links')->count())->toBe(0));
});
