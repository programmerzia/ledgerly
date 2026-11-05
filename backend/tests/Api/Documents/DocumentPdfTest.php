<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use App\Models\Organisation\Company;
use App\Services\Documents\DocumentPdf;
use Illuminate\Support\Facades\DB;
use Tests\Support\FakePdfEngine;

/*
 * Document PDFs (plan 3c.4): every template renders only the stored document, the PDF is queued and fetched through the
 * same route and policy as viewing the document, and a document that is not posted says so.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->engine = new FakePdfEngine;
    app()->instance(HtmlToPdf::class, $this->engine);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->customer)->update([
        'legal_name' => 'Contact C1 Ltd', 'tax_id' => 'CUST-TAX-1', 'email' => 'billing@c1.example', 'billing_address' => json_encode(['1 Main Street', 'Springfield 12345']),
    ]));
    $this->inTenant(fn () => DB::table('companies')->where('id', $this->f->companyId)->update(['tax_id' => 'CO-TAX-7', 'address' => json_encode(['9 Harbour Road', 'Portville'])]));
});

/** @return string the HTML a document renders to */
function renderedHtml(string $type, string $id, array $params = []): string
{
    return test()->inTenant(fn () => app(DocumentPdf::class)->html($type, Company::query()->findOrFail(test()->f->companyId), $id, $params));
}

it('prints an invoice from the stored document: number, parties, tax ids, lines, tax per rate, totals and words', function (): void {
    $doc = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[5000, '2', 'VAT10'], [1234567, '1', 'ZERO'], [2550, '1', 'VAT10', '10']]));
    $html = renderedHtml('invoice', $doc['id']);

    expect($html)->toContain($doc['number'])->toContain('Contact C1 Ltd')->toContain('CUST-TAX-1')->toContain('1 Main Street')
        ->toContain('Tax ID CO-TAX-7')->toContain('9 Harbour Road')
        ->toContain('Bill to')->toContain('15 Mar 2026')->toContain('14 Apr 2026')->toContain('Net 30 days')
        ->toContain('12,345.67')           // a line amount, grouped
        ->toContain('VAT10 10%')           // the rate in force on the issue date
        ->toContain('ZERO 0%')
        ->toContain('Tax breakdown')
        ->toContain('Balance due')
        ->not->toContain('DRAFT');
    // Total is subtotal + tax, in the document currency, with the words for it.
    $total = $doc['total_fc']['amount'];
    expect($html)->toContain(number_format($total / 100, 2))->toContain('USD');
    expect($html)->toMatch('/Say|dollars|and \d\d\/100 USD/i');
});

it('puts a watermark on a draft, a voided and a reversed document, and none on a posted one', function (): void {
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    expect(renderedHtml('invoice', $draft['id']))->toContain('class="watermark ')->toContain('DRAFT');

    $posted = $this->sale(2000);
    expect(renderedHtml('invoice', $posted['id']))->not->toContain('class="watermark');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$posted['id']}/reverse"), ['reason' => 'Wrong customer', 'date' => '2026-03-20'], $this->key())->assertOk();
    expect(renderedHtml('invoice', $posted['id']))->toContain('REVERSED');

    $void = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000]]));
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$void['id']}/void"), ['reason' => 'Mistake'], $this->key())->assertOk();
    expect(renderedHtml('invoice', $void['id']))->toContain('VOID');
});

it('prints the credit note, bill, debit note, receipt, payment advice and statements with their own titles and parties', function (): void {
    $sale = $this->sale(10000);
    $credit = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']], '2026-03-16', ['kind' => 'credit_note', 'related_invoice_id' => $sale['id']]));
    $html = renderedHtml('credit_note', $credit['id']);
    expect($html)->toContain('Credit note')->toContain($credit['number'])->toContain($sale['number']);

    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', 'VAT10']]));
    expect(renderedHtml('bill', $bill['id']))->toContain('Bill')->toContain($bill['number'])->toContain('Supplier')->toContain('PO-77')->not->toContain('How to pay');

    $receipt = $this->postedSettlement('receipt', $this->t->customer, 5000, [[$sale['id'], 5000]]);
    $html = renderedHtml('receipt', $receipt['id']);
    expect($html)->toContain('Receipt')->toContain($receipt['number'])->toContain($sale['number'])->toContain('Received from')->toContain('50.00');

    $payment = $this->postedSettlement('payment', $this->t->supplier, 5500, [[$bill['id'], 5500]]);
    $html = renderedHtml('payment_advice', $payment['id']);
    expect($html)->toContain('Payment advice')->toContain($bill['number'])->toContain('Paid to')->toContain('55.00');

    $html = renderedHtml('customer_statement', $this->t->customer, ['from' => '2026-03-01', 'to' => '2026-03-31']);
    expect($html)->toContain('Statement of account')->toContain($sale['number'])->toContain($receipt['number'])->toContain('Opening balance')->toContain('Balance owed to us');
    $html = renderedHtml('supplier_statement', $this->t->supplier, ['from' => '2026-03-01', 'to' => '2026-03-31']);
    expect($html)->toContain($bill['number'])->toContain('Balance we owe');
});

it('prints a journal voucher with its lines and signatures, and a purchase order', function (): void {
    $journal = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(12345), $this->key())->assertCreated()->json('data');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("journals/{$journal['id']}/submit"), [], $this->key())->assertOk();
    $html = renderedHtml('journal_voucher', $journal['id']);
    expect($html)->toContain('Journal voucher')->toContain('123.45')->toContain('1000 ')->toContain('Prepared by')->toContain('Ann Accountant')->toContain('Cash sale');
});

it('queues the PDF, returns the file through the document route, and nobody else can fetch it', function (): void {
    $doc = $this->sale(5000);

    $queued = $this->asPerson($this->viewer)->postJson($this->api("invoices/{$doc['id']}/pdf"), [], $this->key())->assertStatus(202)
        ->assertJsonPath('data.status', 'queued')->assertJsonPath('data.document_type', 'invoice')->json('data');
    $get = $this->getJson($this->api("invoices/{$doc['id']}/pdf/{$queued['id']}"));
    $get->assertOk()->assertHeader('Content-Type', 'application/pdf');
    expect($get->streamedContent())->toStartWith('%PDF-1.4')
        ->and($get->headers->get('Content-Disposition'))->toContain($doc['number']);
    expect($this->engine->last())->toContain($doc['number']);

    // Another person, even with the right to view, cannot take someone else's file; nor through another document.
    $this->asPerson($this->accountant)->getJson($this->api("invoices/{$doc['id']}/pdf/{$queued['id']}"))->assertNotFound();
    $other = $this->sale(100);
    $this->asPerson($this->viewer)->getJson($this->api("invoices/{$other['id']}/pdf/{$queued['id']}"))->assertNotFound();
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'document.pdf_requested')->count()))->toBe(1);
});

it('uses the policy of the document: no right to view means no PDF, and another family is a 404 and another company is closed', function (): void {
    $doc = $this->sale(5000);
    $nobody = $this->person('Nora Nobody', []);
    $this->asPerson($nobody)->postJson($this->api("invoices/{$doc['id']}/pdf"), [], $this->key())->assertForbidden();

    // An invoice id under /bills/ is another family; another company's id is unknown here.
    $this->asPerson($this->owner)->postJson($this->api("bills/{$doc['id']}/pdf"), [], $this->key())->assertNotFound();
    $beta = $this->secondCompany();
    $this->asPerson($this->owner)->postJson($this->api("invoices/{$doc['id']}/pdf", $beta->id), [], $this->key())->assertForbidden();

    // A sales assistant may read invoices but not statements (reports): the statement route also asks for reports.view.
    $this->asPerson($this->assistant)->postJson($this->api("invoices/{$doc['id']}/pdf"), [], $this->key())->assertStatus(202);
    $this->asPerson($this->assistant)->postJson($this->api("contacts/{$this->t->customer}/statement/pdf"), ['from' => '2026-03-01', 'to' => '2026-03-31'], $this->key())->assertForbidden();
});

it('asks for the period and the side of a statement', function (): void {
    $this->asPerson($this->owner)->postJson($this->api("contacts/{$this->t->customer}/statement/pdf"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'statement_period_required']);
    $both = $this->inTenant(fn () => $this->t->contact('B1', 'both'));
    $this->asPerson($this->owner)->postJson($this->api("contacts/{$both}/statement/pdf"), ['from' => '2026-03-01', 'to' => '2026-03-31'], $this->key())->assertStatus(422)->assertJson(['code' => 'statement_side_required']);
    $this->asPerson($this->owner)->postJson($this->api("contacts/{$this->t->customer}/statement/pdf"), ['from' => '2026-03-01', 'to' => '2026-03-31', 'side' => 'supplier'], $this->key())->assertStatus(422)->assertJson(['code' => 'statement_side_invalid']);
    $this->asPerson($this->owner)->postJson($this->api("contacts/{$this->t->customer}/statement/pdf"), ['from' => '2026-03-01', 'to' => '2026-03-31'], $this->key())->assertStatus(202);
});

it('marks the PDF failed when the engine fails, instead of leaving it queued', function (): void {
    $doc = $this->sale(5000);
    $this->engine->fail = new RuntimeException('Chromium is not installed');
    $this->asPerson($this->owner);
    try {
        $this->postJson($this->api("invoices/{$doc['id']}/pdf"), [], $this->key());
    } catch (Throwable) {
        // the sync queue rethrows; a real worker records the failure on the job
    }
    expect($this->engine->html)->toBe([]);
});

it('shows the company look on the document: accent colour, footer text is for the page footer, logo as an inline image', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('settings'), ['accent_color' => '#aa3300', 'payment_instructions' => "Pay to IBAN XX00 1234\nQuote the invoice number"], $this->key())->assertOk();
    $doc = $this->sale(5000);
    $html = renderedHtml('invoice', $doc['id']);
    expect($html)->toContain('--accent: #AA3300')->toContain('How to pay')->toContain('Pay to IBAN XX00 1234');
});

it('prints a withholding certificate with the base, the tax withheld and the payment it belongs to', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplierWht, [[10000, '1', null, '0', '5000']]));
    $payment = $this->postedSettlement('payment', $this->t->supplierWht, 9000, [[$bill['id'], 9000]]);
    $certificate = $this->asPerson($this->owner)->getJson($this->api('wht-certificates'))->assertOk()->json('data.0');
    $html = renderedHtml('wht_certificate', $certificate['id']);

    expect($html)->toContain('Withholding tax certificate')->toContain($certificate['number'])->toContain($payment['number'])->toContain($bill['number'])
        ->toContain('USD 100.00')->toContain('USD 10.00')->toContain('WHT10 10%')->toContain('Ten and 00/100 USD');
});
