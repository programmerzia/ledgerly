<?php

declare(strict_types=1);

use App\Contracts\AttachmentStore;
use App\Contracts\Clock;
use App\Jobs\Files\ScanAttachment;
use App\Models\Files\Attachment;
use App\Notifications\AttachmentInfectedNotification;
use App\Support\Files\ScannerUnavailable;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->setUpAttachments();
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->invoice = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]))['id'];
});

it('runs the whole flow: presigned upload, completion, scan, promotion and a signed download', function (): void {
    config(['queue.default' => 'database']);
    $this->asPerson($this->accountant);

    $intent = $this->announce('invoice', $this->invoice)->assertCreated()
        ->assertJsonPath('data.scan_status', 'pending')->assertJsonPath('data.upload_completed', false)->assertJsonPath('data.filename', 'receipt.pdf')
        ->assertJsonPath('upload.method', 'PUT');
    $id = $intent->json('data.id');
    expect($intent->json('data'))->not->toHaveKeys(['path', 'disk', 'tenant_id']);

    // The object key holds the tenant and company, sits in quarantine, and its tail is random.
    $row = $this->row($id);
    expect($row['path'])->toStartWith("{$this->f->tenantId}/{$this->f->companyId}/quarantine/")
        ->and(strlen(basename($row['path'])))->toBe(40)
        ->and($row['path'])->not->toContain($id);
    $this->postJson($this->api("attachments/{$id}/complete"), [], $this->key())->assertStatus(409)->assertJson(['code' => 'attachment_not_uploaded']);

    $this->putBytes($intent->json('upload.url'), self::PDF)->assertNoContent();
    expect(Storage::disk('attachments')->get($row['path']))->toBe(self::PDF);
    expect(DB::table('jobs')->count())->toBe(0);
    $this->postJson($this->api("attachments/{$id}/complete"), [], $this->key())->assertOk()->assertJsonPath('data.upload_completed', true)->assertJsonPath('data.scan_status', 'pending');
    $queued = DB::table('jobs')->get();
    expect($queued)->toHaveCount(1)->and($queued[0]->queue)->toBe('scans')->and($queued[0]->payload)->toContain('ScanAttachment')->toContain($id);
    config(['queue.default' => 'sync']);
    $this->postJson($this->api("attachments/{$id}/complete"), [], $this->key())->assertOk(); // twice is harmless

    // Never served before it is clean.
    $this->getJson($this->api("attachments/{$id}/download"))->assertForbidden();
    $this->getJson($this->api("attachments/{$id}"))->assertOk()->assertJsonPath('data.can.download', false);

    $this->runScan($id);
    $this->asPerson($this->accountant);
    $row = $this->row($id);
    expect($row['scan_status'])->toBe('clean')->and($row['mime'])->toBe('application/pdf')->and($row['path'])->toContain('/clean/')
        ->and($this->scanner->scanned)->toBe([self::PDF])
        ->and($this->storedFiles())->toBe([$row['path']]); // the quarantine copy is gone

    $link = $this->getJson($this->api("attachments/{$id}/download"))->assertOk()->assertJsonPath('data.filename', 'receipt.pdf');
    $download = $this->get($link->json('data.url'))->assertOk();
    expect($download->streamedContent())->toBe(self::PDF)
        ->and($download->headers->get('Content-Disposition'))->toStartWith('attachment;')->not->toContain('inline')
        ->and($download->headers->get('Content-Disposition'))->toContain('receipt.pdf')
        ->and($download->headers->get('Content-Type'))->toBe('application/pdf')
        ->and($download->headers->get('X-Content-Type-Options'))->toBe('nosniff');

    $this->getJson($this->api("attachments?attachable_type=invoice&attachable_id={$this->invoice}"))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.scan_status', 'clean');
    $events = $this->inTenant(fn () => DB::table('audit_events')->where('subject_type', 'attachments')->pluck('action')->all());
    expect($events)->toEqualCanonicalizing(['attachment.upload_requested', 'attachment.uploaded', 'attachment.scan_clean']);
});

it('rejects a wrong checksum or size at completion and keeps none of the bytes', function (): void {
    $this->asPerson($this->accountant);
    $tampered = $this->announce('invoice', $this->invoice)->assertCreated();
    $this->putBytes($tampered->json('upload.url'), str_replace('Catalog', 'Catalpa', self::PDF))->assertNoContent(); // same size, other bytes
    $this->postJson($this->api("attachments/{$tampered->json('data.id')}/complete"), [], $this->key())->assertStatus(409)->assertJson(['code' => 'attachment_mismatch']);
    expect($this->storedFiles())->toBe([])->and($this->row($tampered->json('data.id'))['completed_at'])->toBeNull();

    $short = $this->announce('invoice', $this->invoice)->assertCreated();
    $this->putBytes($short->json('upload.url'), '%PDF-short')->assertNoContent();
    $this->postJson($this->api("attachments/{$short->json('data.id')}/complete"), [], $this->key())->assertStatus(409)->assertJson(['code' => 'attachment_mismatch']);
    expect($this->storedFiles())->toBe([]);
});

it('validates size, type, checksum and the parent when announcing, and refuses a body larger than announced', function (): void {
    $this->asPerson($this->accountant);
    $this->announce('invoice', $this->invoice, override: ['size' => config('attachments.max_bytes') + 1])->assertStatus(422)->assertJsonValidationErrors(['size']);
    $this->announce('invoice', $this->invoice, override: ['size' => 0])->assertStatus(422)->assertJsonValidationErrors(['size']);
    $this->announce('invoice', $this->invoice, mime: 'application/x-msdownload', filename: 'x.exe')->assertStatus(422)->assertJsonValidationErrors(['mime']);
    $this->announce('invoice', $this->invoice, mime: 'text/html', filename: 'x.html')->assertStatus(422)->assertJsonValidationErrors(['mime']);
    $this->announce('invoice', $this->invoice, override: ['sha256' => 'abc'])->assertStatus(422)->assertJsonValidationErrors(['sha256']);
    $this->announce('payroll', $this->invoice)->assertStatus(422)->assertJsonValidationErrors(['attachable_type']);
    $this->announce('invoice', 'not-a-uuid')->assertStatus(422)->assertJsonValidationErrors(['attachable_id']);

    $intent = $this->announce('invoice', $this->invoice)->assertCreated();
    $this->putBytes($intent->json('upload.url'), self::PDF.str_repeat('x', 10))->assertStatus(413)->assertJson(['code' => 'upload_too_large']);
    expect($this->storedFiles())->toBe([]);
});

it('sniffs the content type on the server instead of trusting the client', function (): void {
    $this->asPerson($this->accountant);
    $html = '<html><script>alert(1)</script></html>';
    $a = $this->uploaded('invoice', $this->invoice, $html, 'invoice.pdf', 'application/pdf');
    $this->runScan($a['id']);
    $this->asPerson($this->accountant);
    $row = $this->row($a['id']);
    expect($row['scan_status'])->toBe('error')->and($row['scan_detail'])->toStartWith('type_not_allowed:text/html')
        ->and($this->storedFiles())->toBe([])->and($this->scanner->scanned)->toBe([]);
    $this->getJson($this->api("attachments/{$a['id']}/download"))->assertForbidden();

    // A PNG sent as a PDF is accepted for what it is and stored with its real type.
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    $b = $this->uploaded('invoice', $this->invoice, $png, 'scan.pdf', 'application/pdf');
    $this->runScan($b['id']);
    expect($this->row($b['id'])['mime'])->toBe('image/png')->and($this->row($b['id'])['scan_status'])->toBe('clean');
});

it('deletes an infected file, keeps the row, audits it and tells the uploader', function (): void {
    Notification::fake();
    $this->scanner->signature = 'Eicar-Test-Signature';
    $a = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->runScan($a['id']);
    $this->asPerson($this->accountant);

    $row = $this->row($a['id']);
    expect($row['scan_status'])->toBe('infected')->and($row['scan_detail'])->toBe('Eicar-Test-Signature')->and($this->storedFiles())->toBe([]);
    Notification::assertSentTo($this->accountant, AttachmentInfectedNotification::class, fn ($n) => $n->signature === 'Eicar-Test-Signature' && $n->filename === 'receipt.pdf');
    $event = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'attachment.infected')->first());
    expect($event)->not->toBeNull()->and($event->subject_id)->toBe($a['id']);
    $this->getJson($this->api("attachments/{$a['id']}"))->assertOk()->assertJsonPath('data.scan_status', 'infected')->assertJsonPath('data.can.download', false);
    $this->getJson($this->api("attachments/{$a['id']}/download"))->assertForbidden();
});

it('leaves the file pending when the scanner is down, never clean, and finishes once it is back', function (): void {
    $a = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->scanner->down = true;
    expect(fn () => $this->runScan($a['id']))->toThrow(ScannerUnavailable::class);
    $row = $this->row($a['id']);
    expect($row['scan_status'])->toBe('pending')->and($row['scan_attempts'])->toBe(1)->and($row['scan_checked_at'])->not->toBeNull()
        ->and($this->storedFiles())->toHaveCount(1);
    $this->asPerson($this->accountant)->getJson($this->api("attachments/{$a['id']}/download"))->assertForbidden();

    // The job retries with growing backoff for a day; the scheduler picks up whatever the retries missed.
    $job = new ScanAttachment($this->f->tenantId, $this->f->companyId, $a['id']);
    expect($job->backoff())->toBe([15, 30, 60, 120, 300, 600, 900, 1800, 3600])->and($job->tries)->toBe(0);

    $this->scanner->down = false;
    $this->runScan($a['id']);
    expect($this->row($a['id'])['scan_status'])->toBe('clean');
    $this->runScan($a['id']); // judged files are skipped
    expect($this->scanner->scanned)->toHaveCount(1);
});

it('queues scans again from the scheduler only for pending files nobody tried for five minutes', function (): void {
    $a = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->announce('invoice', $this->invoice)->assertCreated(); // never uploaded: not due
    app(TenantContext::class)->clear();
    config(['queue.default' => 'redis']);
    Queue::fake();

    $this->artisan('attachments:scan-pending')->assertSuccessful();
    Queue::assertNothingPushed();

    $this->inTenant(fn () => DB::table('attachments')->where('id', $a['id'])->update(['completed_at' => app(Clock::class)->now()->modify('-6 minutes')->format('Y-m-d H:i:s.uP')]));
    $this->artisan('attachments:scan-pending')->assertSuccessful();
    Queue::assertPushed(ScanAttachment::class, 1);
});

it('adds files to a posted document, flagged, but never removes them (evidence)', function (): void {
    // On a draft, a file can come and go.
    $draftFile = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->deleteJson($this->api("attachments/{$draftFile['id']}"), [], $this->key())->assertNoContent();
    expect($this->storedFiles())->toBe([])->and($this->inTenant(fn () => DB::table('attachments')->count()))->toBe(0);

    $before = $this->uploaded('invoice', $this->invoice);
    $this->getJson($this->api("attachments/{$before['id']}"))->assertJsonPath('data.can.delete', true)->assertJsonPath('data.added_after_posting', false);
    $this->submitDoc('invoices', $this->invoice);

    $this->asPerson($this->accountant);
    $this->getJson($this->api("attachments/{$before['id']}"))->assertJsonPath('data.can.delete', false);
    $this->deleteJson($this->api("attachments/{$before['id']}"), [], $this->key())->assertForbidden();
    $after = $this->uploaded('invoice', $this->invoice);
    expect($after['added_after_posting'])->toBeTrue();
    $this->deleteJson($this->api("attachments/{$after['id']}"), [], $this->key())->assertForbidden();
    $flag = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'attachment.upload_requested')->orderByDesc('id')->first());
    expect(json_decode((string) $flag->context, true))->toBe(['added_after_posting' => true]);
    expect($this->inTenant(fn () => DB::table('attachments')->count()))->toBe(2);
});

it('applies the parent module permissions to people', function (): void {
    $journal = $this->draftDoc('journals', $this->journalBody())['id'];
    $supplier = $this->t->supplier;
    $file = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->runScan($file['id']);

    // A viewer reads but cannot add or remove.
    $this->asPerson($this->viewer);
    $this->getJson($this->api("attachments?attachable_type=invoice&attachable_id={$this->invoice}"))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->api("attachments/{$file['id']}/download"))->assertOk();
    $this->announce('invoice', $this->invoice)->assertForbidden();
    $this->postJson($this->api("attachments/{$file['id']}/complete"), [], $this->key())->assertForbidden();
    $this->deleteJson($this->api("attachments/{$file['id']}"), [], $this->key())->assertForbidden();

    // A sales assistant attaches to invoices and customers, but has no journal or supplier rights.
    $this->asPerson($this->assistant);
    $this->announce('invoice', $this->invoice)->assertCreated();
    $this->announce('contact', $this->t->customer)->assertCreated();
    $this->announce('contact', $supplier)->assertForbidden();
    $this->announce('journal', $journal)->assertForbidden();
    $this->getJson($this->api("attachments?attachable_type=journal&attachable_id={$journal}"))->assertForbidden();

    // An accountant manages contacts of every kind and journals.
    $this->asPerson($this->accountant);
    $this->announce('contact', $supplier)->assertCreated();
    $this->announce('journal', $journal)->assertCreated();
});

it('gives API clients attachments:read and attachments:write abilities only', function (): void {
    $file = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $this->runScan($file['id']);

    $this->asToken($this->newToken(['attachments:read']));
    $this->getJson($this->api("attachments/{$file['id']}"))->assertOk();
    $this->getJson($this->api("attachments?attachable_type=invoice&attachable_id={$this->invoice}"))->assertOk();
    $this->getJson($this->api("attachments/{$file['id']}/download"))->assertOk();
    $this->announce('invoice', $this->invoice)->assertForbidden();
    $this->deleteJson($this->api("attachments/{$file['id']}"), [], $this->key())->assertForbidden();

    $this->asToken($this->newToken(['invoices:write', 'invoices:read']));
    $this->getJson($this->api("attachments/{$file['id']}"))->assertForbidden();
    $this->announce('invoice', $this->invoice)->assertForbidden();

    $this->asToken($this->newToken(['attachments:read', 'attachments:write']));
    $own = $this->uploaded('invoice', $this->invoice, filename: 'from-erp.pdf');
    $this->deleteJson($this->api("attachments/{$own['id']}"), [], $this->key())->assertNoContent();
    // A token for another company only is refused outright.
    $other = $this->secondCompany();
    $this->asToken($this->newToken(['attachments:read', 'attachments:write'], [$other->id]));
    $this->getJson($this->api("attachments/{$file['id']}"))->assertForbidden();
});

it('treats another company\'s ids as unknown: 404 in the path, 422 in the body', function (): void {
    $file = $this->asPerson($this->accountant)->uploaded('invoice', $this->invoice);
    $other = $this->secondCompany();
    $owner = $this->person('Beta Owner', ['Owner'], $other->id);
    $this->asPerson($owner);
    $contactB = $this->postJson($this->api('contacts', $other->id), ['kind' => 'customer', 'code' => 'BETA-C', 'name' => 'Beta customer', 'default_currency' => 'USD'], $this->key())->assertCreated()->json('data.id');
    $beta = fn (string $path) => $this->api($path, $other->id);

    $this->getJson($beta("attachments/{$file['id']}"))->assertNotFound();
    $this->getJson($beta("attachments/{$file['id']}/download"))->assertNotFound();
    $this->postJson($beta("attachments/{$file['id']}/complete"), [], $this->key())->assertNotFound();
    $this->deleteJson($beta("attachments/{$file['id']}"), [], $this->key())->assertNotFound();
    $this->postJson($beta('attachments/uploads'), ['attachable_type' => 'invoice', 'attachable_id' => $this->invoice, 'filename' => 'a.pdf', 'mime' => 'application/pdf', 'size' => 10, 'sha256' => str_repeat('a', 64)], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['attachable_id']);
    $this->getJson($beta("attachments?attachable_type=invoice&attachable_id={$this->invoice}"))->assertStatus(422)->assertJsonValidationErrors(['attachable_id']);

    // An invoice id is no bill, and a contact of another company no contact here.
    $this->asPerson($this->accountant);
    $this->announce('bill', $this->invoice)->assertStatus(422)->assertJsonValidationErrors(['attachable_id']);
    $this->announce('contact', $contactB)->assertStatus(422)->assertJsonValidationErrors(['attachable_id']);
    $this->getJson($this->api('attachments/'.Str::uuid()))->assertNotFound();
});

it('refuses unsigned, forged, expired and out-of-order file URLs', function (): void {
    $this->asPerson($this->accountant);
    $intent = $this->announce('invoice', $this->invoice)->assertCreated();
    $id = $intent->json('data.id');
    $tenant = $this->f->tenantId;
    $url = $intent->json('upload.url');

    // Upload: no signature, a tampered one, another attachment's id, and after expiry.
    $this->putBytes("http://localhost/api/v1/attachment-uploads/{$tenant}/{$id}", self::PDF)->assertForbidden();
    $this->putBytes($url.'0', self::PDF)->assertForbidden();
    $this->putBytes(str_replace($id, (string) Str::uuid(), $url), self::PDF)->assertForbidden();
    $this->travel(16)->minutes();
    $this->putBytes($url, self::PDF)->assertForbidden();
    $this->travelBack();

    $fresh = $this->announce('invoice', $this->invoice)->assertCreated();
    $this->putBytes($fresh->json('upload.url'), self::PDF)->assertNoContent();
    $this->postJson($this->api("attachments/{$fresh->json('data.id')}/complete"), [], $this->key())->assertOk();
    $this->putBytes($fresh->json('upload.url'), 'overwrite')->assertForbidden(); // verified bytes are final

    // Download: signature required, tamper-proof, expiring, and nothing is served before it is clean.
    $store = app(AttachmentStore::class);
    $row = $fresh->json('data.id');
    $signed = $this->inTenant(fn () => $store->downloadUrl(Attachment::query()->findOrFail($row), now()->addMinutes(5)));
    $this->get($signed)->assertNotFound(); // pending: a valid signature is still no access
    $this->runScan($row);
    $this->asPerson($this->accountant);
    $this->get($signed)->assertOk();
    $this->get("http://localhost/api/v1/attachment-files/{$tenant}/{$row}")->assertForbidden();
    $this->get($signed.'&x=1')->assertForbidden();
    $this->get(str_replace($row, $id, $signed))->assertForbidden();
    $this->travel(6)->minutes();
    $this->get($signed)->assertForbidden();
    $this->travelBack();
});

it('stores a safe filename: no path, no line breaks, no header injection', function (): void {
    $this->asPerson($this->accountant);
    $hostile = "../../etc/passwd\r\nSet-Cookie: pwned=1\r\n\r\n<script>.pdf";
    $a = $this->uploaded('invoice', $this->invoice, filename: $hostile);
    expect($a['filename'])->not->toContain("\r")->not->toContain("\n")->not->toContain('/')->not->toContain('..')->not->toContain('<');
    $this->runScan($a['id']);
    $this->asPerson($this->accountant);
    $url = $this->getJson($this->api("attachments/{$a['id']}/download"))->assertOk()->json('data.url');
    $response = $this->get($url)->assertOk();
    $disposition = (string) $response->headers->get('Content-Disposition');
    expect($disposition)->toStartWith('attachment;')->not->toContain("\n")->not->toContain("\r")
        ->and(implode(';', (array) $response->headers->all('set-cookie')))->not->toContain('pwned')
        ->and(array_keys($response->headers->all()))->not->toContain('x-injected')
        ->and($this->storedFiles()[0])->not->toContain('passwd')->not->toContain('..');

    $b = $this->uploaded('invoice', $this->invoice, filename: '..\\..\\windows\\system32\\évidence "q" %0d.pdf');
    expect($b['filename'])->toBe('évidence_q_0d.pdf');
});

it('keeps keys under the tenant and company and unique per upload', function (): void {
    $this->asPerson($this->accountant);
    $one = $this->announce('invoice', $this->invoice)->assertCreated()->json('data.id');
    $two = $this->announce('invoice', $this->invoice)->assertCreated()->json('data.id');
    [$p1, $p2] = [$this->row($one)['path'], $this->row($two)['path']];
    expect($p1)->not->toBe($p2)->and($p1)->toContain($this->f->tenantId)->and($p1)->toContain($this->f->companyId);
});
