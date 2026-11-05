<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Mime\Email;
use Tests\Support\FakePdfEngine;

/*
 * Sending documents by email (plan 3c.5): only posted documents, recipients from the contact and editable, the company's
 * message templates with an allowlist of placeholders, a send log with an audit event, one mail per request and a limit.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->engine = new FakePdfEngine;
    app()->instance(HtmlToPdf::class, $this->engine);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->customer)->update(['email' => 'billing@c1.example']));
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->supplier)->update(['email' => 'ap@s1.example']));
});

/** @return list<Email> the messages the array mailer has taken */
function sentMessages(): array
{
    return array_map(fn ($m) => $m->getOriginalMessage(), app('mailer')->getSymfonyTransport()->messages()->all());
}

it('offers the message as it would go out, with the contact address as the default recipient', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->accountant)->getJson($this->api("invoices/{$doc['id']}/email-draft"))->assertOk()
        ->assertJsonPath('data.recipients', ['billing@c1.example'])
        ->assertJsonPath('data.subject', "Invoice {$doc['number']} from Acme acme")
        ->assertJsonPath('data.can_send', true)
        ->assertJson(fn ($json) => $json->where('data.body', fn (string $b) => str_contains($b, 'Dear Contact C1') && str_contains($b, 'USD 55.00') && ! str_contains($b, '{{'))->etc());
});

it('sends a posted invoice with its PDF attached, logs it, audits it and shows it on the document', function (): void {
    $doc = $this->sale(5000);

    $send = $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/emails"), [
        'recipients' => ['Billing@C1.example', 'cfo@c1.example'], 'subject' => 'Your invoice', 'body' => "Hello <b>there</b>\nThanks",
    ], $this->key())->assertStatus(202)->assertJsonPath('data.status', 'queued')->json('data');

    $messages = sentMessages();
    expect($messages)->toHaveCount(1);
    $mail = $messages[0];
    expect(array_map(fn ($a) => $a->getAddress(), $mail->getTo()))->toBe(['billing@c1.example', 'cfo@c1.example'])
        ->and($mail->getSubject())->toBe('Your invoice');
    $attachments = $mail->getAttachments();
    expect($attachments)->toHaveCount(1)
        ->and($attachments[0]->getFilename())->toBe("Invoice-{$doc['number']}.pdf")
        ->and($attachments[0]->getBody())->toStartWith('%PDF-1.4');
    // The body is plain text in the text part and escaped in the HTML part: nothing of it is markup.
    expect($mail->getTextBody())->toContain('Hello <b>there</b>')->and($mail->getHtmlBody())->toContain('&lt;b&gt;there&lt;/b&gt;')->not->toContain('<b>there</b>');

    $log = $this->asPerson($this->viewer)->getJson($this->api("invoices/{$doc['id']}/emails"))->assertOk()->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.status', 'sent')->assertJsonPath('data.0.recipients', ['billing@c1.example', 'cfo@c1.example'])
        ->assertJsonPath('data.0.queued_by_name', 'Ann Accountant')->assertJsonPath('data.0.id', $send['id'])->json('data.0');
    expect($log['sent_at'])->not->toBeNull();

    $events = $this->inTenant(fn () => DB::table('audit_events')->whereIn('action', ['document.email_queued', 'document.emailed'])->orderBy('id')->get());
    expect($events->pluck('action')->all())->toBe(['document.email_queued', 'document.emailed'])
        ->and($events->every(fn ($e) => $e->subject_type === 'invoices' && $e->subject_id === $doc['id']))->toBeTrue();
});

it('refuses a document that is not posted with a plain sentence, and receipts and bills', function (): void {
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$draft['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'document_not_posted', 'detail' => 'Only a posted document can be sent. Post it first, then send it.']);

    $sale = $this->sale(5000);
    $receipt = $this->postedSettlement('receipt', $this->t->customer, 1000, [[$sale['id'], 1000]]);
    $this->asPerson($this->accountant)->postJson($this->api("settlements/{$receipt['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'not_sendable']);
    expect(sentMessages())->toBe([]);
});

it('refuses a reversed invoice', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$doc['id']}/reverse"), ['reason' => 'Wrong customer', 'date' => '2026-03-20'], $this->key())->assertOk();
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'document_not_posted']);
});

it('needs the documents.send permission, and the viewer and the API client are refused', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->viewer)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())->assertStatus(202);
    $token = $this->newToken(['invoices:read', 'invoices:write']);
    $this->asToken($token)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['c@d.example']], $this->key())->assertForbidden();
});

it('validates recipients and the message', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->accountant);
    $url = $this->api("invoices/{$doc['id']}/emails");
    $this->postJson($url, ['recipients' => []], $this->key())->assertStatus(422)->assertJsonValidationErrors(['recipients']);
    $this->postJson($url, ['recipients' => ['not-an-address']], $this->key())->assertStatus(422)->assertJson(['code' => 'recipient_invalid']);
    $this->postJson($url, ['recipients' => ['a@b.example'], 'subject' => str_repeat('x', 201)], $this->key())->assertStatus(422)->assertJsonValidationErrors(['subject']);
    $this->postJson($url, ['recipients' => ['a@b.example', 'b@b.example', 'c@b.example', 'd@b.example', 'e@b.example', 'f@b.example']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['recipients']);
    expect(sentMessages())->toBe([]);
});

it('uses the company template with only the listed placeholders, and refuses unknown ones when it is saved', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->owner)->putJson($this->api('settings'), ['email_templates' => ['invoice' => ['subject' => 'Bill {{ document_number }} / {{company_name}}', 'body' => 'Hi {{contact_name}}, {{ total }} due {{due_date}}. {{ nothing }}']]], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['email_templates.invoice.body']);
    $this->putJson($this->api('settings'), ['email_templates' => ['invoice' => ['subject' => 'Bill {{ document_number }} / {{company_name}}', 'body' => 'Hi {{contact_name}}, {{ total }} due {{due_date}}.']]], $this->key())
        ->assertOk()->assertJsonPath('data.email_templates.invoice.subject', 'Bill {{ document_number }} / {{company_name}}')->assertJsonPath('data.email_templates.credit_note.subject', 'Credit note {{document_number}} from {{company_name}}');

    $this->asPerson($this->accountant)->getJson($this->api("invoices/{$doc['id']}/email-draft"))->assertOk()
        ->assertJsonPath('data.subject', "Bill {$doc['number']} / Acme acme")->assertJsonPath('data.body', 'Hi Contact C1, USD 55.00 due 14 Apr 2026.');

    // Sent with no subject or body given, the template is used.
    $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(202);
    expect(sentMessages()[0]->getSubject())->toBe("Bill {$doc['number']} / Acme acme");
});

it('replays a retried request and refuses the same message sent twice in a row', function (): void {
    $doc = $this->sale(5000);
    $key = $this->key();
    $this->asPerson($this->accountant);
    $first = $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $key)->assertStatus(202)->json('data.id');
    $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $key)->assertStatus(202)->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first);
    expect(sentMessages())->toHaveCount(1);

    // A second click with a fresh key a moment later is the same message to the same person: refused, calmly.
    $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(422)->assertJson(['code' => 'already_sent']);
    // To someone else it is a new send.
    $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['other@c1.example']], $this->key())->assertStatus(202);
    expect(sentMessages())->toHaveCount(2);
});

it('sends a credit note, a payment advice and a statement, each with its own template and a PDF', function (): void {
    $sale = $this->sale(10000);
    $credit = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']], '2026-03-16', ['kind' => 'credit_note', 'related_invoice_id' => $sale['id']]));
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', 'VAT10']]));
    $payment = $this->postedSettlement('payment', $this->t->supplier, 5500, [[$bill['id'], 5500]]);
    $this->asPerson($this->accountant);

    $this->getJson($this->api("invoices/{$credit['id']}/email-draft"))->assertOk()->assertJsonPath('data.document_type', 'credit_note');
    $this->postJson($this->api("invoices/{$credit['id']}/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(202);
    $this->getJson($this->api("settlements/{$payment['id']}/email-draft"))->assertOk()->assertJsonPath('data.recipients', ['ap@s1.example'])->assertJsonPath('data.document_type', 'payment_advice');
    $this->postJson($this->api("settlements/{$payment['id']}/emails"), ['recipients' => ['ap@s1.example']], $this->key())->assertStatus(202);

    $this->getJson($this->api("contacts/{$this->t->customer}/statement/email-draft?from=2026-03-01&to=2026-03-31"))->assertOk()
        ->assertJsonPath('data.document_type', 'statement')
        ->assertJson(fn ($json) => $json->where('data.body', fn (string $b) => str_contains($b, '01 Mar 2026') && str_contains($b, '31 Mar 2026') && str_contains($b, 'USD'))->etc());
    $this->postJson($this->api("contacts/{$this->t->customer}/statement/emails"), ['recipients' => ['billing@c1.example'], 'from' => '2026-03-01', 'to' => '2026-03-31'], $this->key())->assertStatus(202);
    $this->postJson($this->api("contacts/{$this->t->customer}/statement/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(422)->assertJson(['code' => 'statement_period_required']);

    $messages = sentMessages();
    expect($messages)->toHaveCount(3)
        ->and(array_map(fn ($m) => $m->getAttachments()[0]->getFilename(), $messages))->toBe(["Credit-note-{$credit['number']}.pdf", "Payment-advice-{$payment['number']}.pdf", 'Statement-2026-03-31.pdf']);
    $this->getJson($this->api("contacts/{$this->t->customer}/statement/emails"))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.document_type', 'statement');
});

it('records a failed send with the reason instead of losing it', function (): void {
    $doc = $this->sale(5000);
    $this->engine->fail = new RuntimeException('Chromium is not installed');
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(202);

    $this->getJson($this->api("invoices/{$doc['id']}/emails"))->assertOk()->assertJsonPath('data.0.status', 'failed')->assertJsonPath('data.0.error', 'Chromium is not installed');
    expect(sentMessages())->toBe([])
        ->and($this->inTenant(fn () => DB::table('audit_events')->where('action', 'document.email_failed')->count()))->toBe(1);
});

it('limits sends per company per hour', function (): void {
    config(['documents.emails_per_hour' => 2]);
    $doc = $this->sale(5000);
    $this->asPerson($this->accountant);
    foreach (['a', 'b'] as $who) {
        $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ["{$who}@c1.example"]], $this->key())->assertStatus(202);
    }
    $this->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['c@c1.example']], $this->key())->assertStatus(429);
});

it('keeps another company out of the log', function (): void {
    $doc = $this->sale(5000);
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['billing@c1.example']], $this->key())->assertStatus(202);
    $beta = $this->secondCompany();
    $owner = $this->person('Beta Owner', ['Owner'], $beta->id);
    $this->asPerson($owner)->getJson($this->api("invoices/{$doc['id']}/emails", $beta->id))->assertNotFound();
});
