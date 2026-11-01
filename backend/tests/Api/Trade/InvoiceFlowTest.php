<?php

declare(strict_types=1);

use App\Models\Trade\Invoice;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;

/*
 * Sales and purchase documents over HTTP (plan 2.11): the server prices them, posting goes through the journal
 * engine in one transaction, numbers are gapless per kind, and the lifecycle is the journal's.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('prices a sales invoice on the server and ignores client-sent totals', function (): void {
    // 2 × 50.00 and 1 × 25.50 less 10% = 100.00 + 22.95; VAT 10%: 10.00 + 2.295, rounded once per code to 12.30 (D2)
    $body = $this->t->body($this->t->customer, [[5000, '2', 'VAT10'], [2550, '1', 'VAT10', '10']]);
    $body += ['total_fc' => 1, 'tax_total_fc' => 1, 'subtotal' => 1, 'total' => 1, 'lines_total' => 1];
    $body['lines'][0] += ['line_total_fc' => 1, 'tax_amount_fc' => 1];

    $doc = $this->asPerson($this->accountant)->postJson($this->api('invoices'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.kind', 'sales_invoice')->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)
        ->assertJsonPath('data.currency', 'USD')->assertJsonPath('data.fx_rate', '1.00000000')
        ->assertJsonPath('data.due_date', '2026-04-14')
        ->assertJsonPath('data.subtotal_fc.amount', 12295)->assertJsonPath('data.tax_total_fc.amount', 1230)->assertJsonPath('data.total_fc.amount', 13525)
        ->assertJsonPath('data.total.amount', 13525)->assertJsonPath('data.amount_due.amount', 0)
        ->assertJsonPath('data.payment_status', 'draft')->assertJsonPath('data.version', 0)
        ->assertJsonPath('data.lines.0.line_total_fc.amount', 10000)->assertJsonPath('data.lines.0.tax_amount_fc.amount', 1000)
        ->assertJsonPath('data.lines.1.line_total_fc.amount', 2295)->assertJsonPath('data.lines.1.tax_amount_fc.amount', 230)
        ->assertJsonPath('data.can.update', true)->assertJsonPath('data.can.approve', false)
        ->json('data');

    expect($this->inTenant(fn () => Invoice::query()->count()))->toBe(1);
});

it('posts a sales invoice: Dr AR, Cr revenue per line, Cr output VAT, with a gapless number and a linked journal', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[5000, '2', 'VAT10'], [2550, '1', 'VAT10', '10']]));

    $this->postJson($this->api("invoices/{$doc['id']}/posting-preview"), [], $this->key())->assertOk()
        ->assertJsonPath('data.valid', true)->assertJsonPath('data.total_debit.amount', 13525)->assertJsonPath('data.number', null)
        ->assertJsonPath('data.period.name', fn ($n) => is_string($n))
        ->assertJsonPath('data.lines.0.debit.amount', 13525)->assertJsonPath('data.lines.0.due_date', '2026-04-14')
        ->assertJsonCount(4, 'data.lines');

    $posted = $this->submitDoc('invoices', $doc['id']);
    expect($posted['status'])->toBe('posted')->and($posted['number'])->toBe('INV-FY2026-00001')->and($posted['payment_status'])->toBeIn(['awaiting_payment', 'overdue']);

    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '1100' => ['debit' => 13525, 'credit' => 0],
        '4000' => ['debit' => 0, 'credit' => 12295],
        '2100' => ['debit' => 0, 'credit' => 1230],
    ]);
    $journal = $this->inTenant(fn () => DB::table('journals')->where('id', $posted['journal_id'])->first());
    expect($journal->status)->toBe('posted')->and($journal->journal_type)->toBe('sales')->and($journal->source_type)->toBe('sales_invoice')
        ->and($journal->source_id)->toBe($doc['id'])->and($journal->number)->toBe('JV-FY2026-00001')
        ->and($journal->reference)->toBe('INV-FY2026-00001')->and((int) $journal->total_debit)->toBe(13525);
    $ar = $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $journal->id)->orderBy('line_no')->first());
    expect($ar->contact_id)->toBe($this->t->customer)->and($ar->due_date)->toBe('2026-04-14');

    // Immutable now: no edit, and the draft routes say so.
    $this->putJson($this->api("invoices/{$doc['id']}"), [...$this->t->body($this->t->customer, [[1, '1']]), 'version' => $posted['version']], $this->key())->assertForbidden();
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('posts a bill with recoverable VAT and withholding tax: Cr AP net of WHT, Cr WHT payable, Dr expense, Dr input VAT', function (): void {
    // 400.00 + 10% VAT = 440.00; the supplier's WHT code is 10% of the 400.00 net = 40.00, so the supplier is owed 400.00
    $doc = $this->draftDoc('bills', $this->t->body($this->t->supplierWht, [[40000, '1', 'VAT10', null, '5000']]));
    expect($doc['wht_amount_fc']['amount'])->toBe(4000)->and($doc['wht_code_id'])->toBe($this->t->tax['WHT10'])->and($doc['total_fc']['amount'])->toBe(44000);

    $posted = $this->submitDoc('bills', $doc['id']);
    expect($posted['number'])->toBe('BILL-FY2026-00001')->and($posted['kind'])->toBe('purchase_bill')
        ->and($posted['amount_due']['amount'])->toBe(40000);
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '2000' => ['debit' => 0, 'credit' => 40000],
        '2120' => ['debit' => 0, 'credit' => 4000],
        '5000' => ['debit' => 40000, 'credit' => 0],
        '2110' => ['debit' => 4000, 'credit' => 0],
    ]);
    expect($this->inTenant(fn () => DB::table('journals')->where('id', $posted['journal_id'])->value('journal_type')))->toBe('purchase');
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('lets the client drop the contact\'s default withholding code with an explicit null', function (): void {
    $doc = $this->draftDoc('bills', $this->t->body($this->t->supplierWht, [[40000, '1', null, null, '5000']], extra: ['wht_code_id' => null]));
    expect($doc['wht_amount_fc']['amount'])->toBe(0)->and($doc['wht_code_id'])->toBeNull();
});

it('capitalises VAT that is not recoverable into the expense (IAS 2.11, IAS 16.16)', function (): void {
    $posted = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'VATNR', null, '5000']]));
    expect($posted['total_fc']['amount'])->toBe(11000)->and($posted['tax_total_fc']['amount'])->toBe(1000);
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '2000' => ['debit' => 0, 'credit' => 11000],
        '5000' => ['debit' => 11000, 'credit' => 0],
    ]);
});

it('posts a credit note as the mirror of the invoice and leaves its amount as credit to apply', function (): void {
    $invoice = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[5000, '2', 'VAT10'], [2550, '1', 'VAT10', '10']]));

    // Credits one 50.00 unit and its VAT: 50.00 + 5.00 = 55.00.
    $note = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[5000, '1', 'VAT10']], extra: ['kind' => 'credit_note', 'related_invoice_id' => $invoice['id']]));
    expect($note['kind'])->toBe('credit_note')->and($note['related_invoice_id'])->toBe($invoice['id'])->and($note['total_fc']['amount'])->toBe(5500);

    $posted = $this->submitDoc('invoices', $note['id']);
    expect($posted['number'])->toBe('CN-FY2026-00001')->and($posted['amount_due']['amount'])->toBe(5500);
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '1100' => ['debit' => 0, 'credit' => 5500],
        '4000' => ['debit' => 5000, 'credit' => 0],
        '2100' => ['debit' => 500, 'credit' => 0],
    ]);
    $row = $this->inTenant(fn () => DB::table('journals')->where('id', $posted['journal_id'])->first());
    expect($row->source_type)->toBe('credit_note')->and($row->journal_type)->toBe('sales');

    // The invoice and its credit note count separately; net AR is 135.25 − 55.00 = 80.25 (the sub-ledger ties to control).
    $ar = $this->inTenant(fn () => (int) DB::table('journal_lines')->where('account_id', $this->f->account('1100'))->sum(DB::raw('debit - credit')));
    expect($ar)->toBe(13525 - 5500)->and($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('posts a debit note as the mirror of the bill, including the withheld tax', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplierWht, [[40000, '1', 'VAT10', null, '5000']]));

    // Returns goods worth 100.00 + 10.00 VAT; WHT 10% of 100.00 = 10.00; the supplier's account is debited 100.00.
    $note = $this->draftDoc('bills', $this->t->body($this->t->supplierWht, [[10000, '1', 'VAT10', null, '5000']], extra: ['kind' => 'debit_note', 'related_invoice_id' => $bill['id']]));
    $posted = $this->submitDoc('bills', $note['id']);

    expect($posted['number'])->toBe('DN-FY2026-00001')->and($posted['amount_due']['amount'])->toBe(10000);
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '2000' => ['debit' => 10000, 'credit' => 0],
        '2120' => ['debit' => 1000, 'credit' => 0],
        '5000' => ['debit' => 0, 'credit' => 10000],
        '2110' => ['debit' => 0, 'credit' => 1000],
    ]);
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('refuses a note that refers to the wrong kind, another contact, or a document that is not posted', function (): void {
    $draftInvoice = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $other = $this->inTenant(fn () => $this->t->contact('C2', 'customer'));
    $posted = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $this->asPerson($this->accountant);

    $note = fn (string $contact, string $related) => $this->t->body($contact, [[500, '1']], extra: ['kind' => 'credit_note', 'related_invoice_id' => $related]);
    $this->postJson($this->api('invoices'), $note($this->t->customer, $draftInvoice['id']), $this->key())->assertStatus(422)->assertJson(['code' => 'related_document_not_posted']);
    $this->postJson($this->api('invoices'), $note($other, $posted['id']), $this->key())->assertStatus(422)->assertJson(['code' => 'related_document_invalid']);
    $this->postJson($this->api('invoices'), [...$this->t->body($this->t->customer, [[500, '1']]), 'related_invoice_id' => $posted['id']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'related_document_invalid']);
});

it('converts a foreign-currency invoice once per amount and books the rounding residue (D1)', function (): void {
    // EUR 10.01 × 3 at 1.0725: each line 10.7357 -> 10.74, three lines 32.22; the receivable 30.03 × 1.0725 = 32.2072 -> 32.21.
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1001, '1', null, null, '4010'], [1001, '1', null, null, '4010'], [1001, '1', null, null, '4010']], extra: ['currency' => 'EUR', 'fx_rate' => '1.0725']));
    expect($doc['currency'])->toBe('EUR')->and($doc['fx_rate'])->toBe('1.07250000')->and($doc['total_fc']['amount'])->toBe(3003)->and($doc['total_fc']['currency'])->toBe('EUR')
        ->and($doc['total'])->toBe(['amount' => 3221, 'currency' => 'USD'])->and($doc['subtotal']['amount'])->toBe(3222);

    $posted = $this->submitDoc('invoices', $doc['id']);
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '1100' => ['debit' => 3221, 'credit' => 0],
        '4010' => ['debit' => 0, 'credit' => 3222],
        '9999' => ['debit' => 1, 'credit' => 0],
    ]);
    $lines = $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $posted['journal_id'])->orderBy('line_no')->get());
    expect($lines[0]->currency)->toBe('EUR')->and((int) $lines[0]->amount_fc)->toBe(3003)->and($lines[1]->currency)->toBe('EUR')->and((int) $lines[1]->amount_fc)->toBe(-1001)
        ->and($lines[4]->currency)->toBe('USD')->and((int) $lines[4]->amount_fc)->toBe(1);
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('takes the foreign rate from the stored rates on the issue date, and refuses with fx_rate_missing when there is none', function (): void {
    $body = $this->t->body($this->t->customer, [[1000, '1', null, null, '4010']], extra: ['currency' => 'EUR']);
    $this->asPerson($this->accountant)->postJson($this->api('invoices'), $body, $this->key())->assertStatus(422)->assertJson(['code' => 'fx_rate_missing']);

    $this->inTenant(fn () => $this->t->rate('EUR', '2026-03-10', '1.1000'));
    $this->asPerson($this->accountant)->postJson($this->api('invoices'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.fx_rate', '1.10000000')->assertJsonPath('data.total.amount', 1100);
    // A rate the client states wins, and is kept on the document.
    $this->postJson($this->api('invoices'), [...$body, 'fx_rate' => '1.2'], $this->key())->assertCreated()->assertJsonPath('data.total.amount', 1200);
    $this->postJson($this->api('invoices'), [...$body, 'fx_rate' => '-1'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['fx_rate']);
    $this->postJson($this->api('invoices'), [...$body, 'fx_rate' => '0'], $this->key())->assertStatus(422)->assertJson(['code' => 'fx_rate_invalid']);
});

it('refuses a foreign-currency document that states base tax but no tax in its own currency (D10)', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', null, null, '4010']], extra: ['currency' => 'EUR', 'fx_rate' => '2']));
    // Corrupt it the way a faulty importer could: base tax, no document-currency tax.
    $this->inTenant(fn () => DB::table('invoices')->where('id', $doc['id'])->update(['tax_total' => 1500]));

    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/posting-preview"), [], $this->key())->assertOk()
        ->assertJsonPath('data.valid', false)->assertJsonPath('data.violations.0.code', 'tax_total_fc_missing');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_total_fc_missing']);
    expect($this->inTenant(fn () => DB::table('invoices')->where('id', $doc['id'])->value('status')))->toBe('draft');
});

it('refuses a document whose lines no longer add up to its totals', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1']]));
    $this->inTenant(fn () => DB::table('invoice_lines')->where('invoice_id', $doc['id'])->update(['line_total_fc' => 9999]));

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'document_totals_inconsistent']);
});

it('numbers each kind gaplessly, assigns the number only at posting, and gives a refused posting back its number', function (): void {
    $a = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $b = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[2000, '1']]));
    $late = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[3000, '1']], '2026-05-10'));
    $c = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[4000, '1']]));
    expect([$a['number'], $b['number']])->toBe([null, null]);

    expect($this->submitDoc('invoices', $a['id'])['number'])->toBe('INV-FY2026-00001');
    // May is closed: the posting is refused after the number was taken; the rollback returns it.
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-05-10', 'closed'));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$late['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_closed']);
    expect($this->submitDoc('invoices', $b['id'])['number'])->toBe('INV-FY2026-00002');
    expect($this->submitDoc('invoices', $c['id'])['number'])->toBe('INV-FY2026-00003');

    // Another kind counts on its own; the journals take theirs from the journal sequence.
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[1000, '1', null, null, '5000']]));
    expect($bill['number'])->toBe('BILL-FY2026-00001');
    expect($this->inTenant(fn () => DB::table('journals')->orderBy('number')->pluck('number')->all()))->toBe(['JV-FY2026-00001', 'JV-FY2026-00002', 'JV-FY2026-00003', 'JV-FY2026-00004']);
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('refuses posting into a closed period and into a soft-closed one without the permission (D5)', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']], '2026-06-10'));

    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-06-10', 'closed'));
    $this->postJson($this->api("invoices/{$doc['id']}/posting-preview"), [], $this->key())->assertOk()->assertJsonPath('data.violations.0.code', 'period_closed');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_closed']);

    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-06-10', 'soft_closed'));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_soft_closed']);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');

    // An API client can never post into a soft-closed period.
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-07-10', 'soft_closed'));
    $july = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']], '2026-07-10'));
    $this->asToken($this->newToken(['invoices:read', 'invoices:submit']))->postJson($this->api("invoices/{$july['id']}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_soft_closed']);
});

it('defaults from the item and the contact when the line leaves them out', function (): void {
    $item = $this->asPerson($this->owner)->postJson($this->api('items'), [
        'code' => 'CONS', 'name' => 'Consulting hour', 'kind' => 'service', 'currency' => 'USD', 'sales_price' => 12000,
        'sales_account_id' => $this->f->account('4000'), 'tax_code_id' => $this->t->tax['VAT10'],
    ], $this->key())->assertCreated()->json('data');

    $doc = $this->asPerson($this->accountant)->postJson($this->api('invoices'), [
        'contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => [['item_id' => $item['id'], 'quantity' => '1.5']],
    ], $this->key())->assertCreated()->assertJsonPath('data.lines.0.account_id', $this->f->account('4000'))
        ->assertJsonPath('data.lines.0.unit_price_fc.amount', 12000)->assertJsonPath('data.lines.0.line_total_fc.amount', 18000)
        ->assertJsonPath('data.tax_total_fc.amount', 1800)->json('data');
    expect($doc['lines'][0]['tax_code_id'])->toBe($this->t->tax['VAT10']);

    // An explicit null drops the item's tax code; a line with no account anywhere is refused.
    $this->postJson($this->api('invoices'), [
        'contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => [['item_id' => $item['id'], 'quantity' => '1', 'tax_code_id' => null]],
    ], $this->key())->assertCreated()->assertJsonPath('data.tax_total_fc.amount', 0);
    $this->postJson($this->api('invoices'), [
        'contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => [['quantity' => '1', 'unit_price_fc' => 100]],
    ], $this->key())->assertStatus(422)->assertJson(['code' => 'line_account_missing']);
});

it('validates quantities, discounts and prices as the shape the API promises', function (): void {
    $this->asPerson($this->accountant);
    $line = fn (array $over) => $this->t->body($this->t->customer, [[1000, '1']])['lines'][0] + $over;
    $post = fn (array $over) => $this->postJson($this->api('invoices'), ['contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => [array_replace($line([]), $over)]], $this->key());

    $post(['quantity' => '0'])->assertStatus(422)->assertJsonValidationErrors(['lines.0.quantity']);
    $post(['quantity' => 1.5])->assertStatus(422)->assertJsonValidationErrors(['lines.0.quantity']);   // a JSON number, not a string
    $post(['quantity' => '1.1234567'])->assertStatus(422)->assertJsonValidationErrors(['lines.0.quantity']);
    $post(['discount_pct' => '100.0001'])->assertStatus(422)->assertJsonValidationErrors(['lines.0.discount_pct']);
    $post(['unit_price_fc' => -1])->assertStatus(422)->assertJsonValidationErrors(['lines.0.unit_price_fc']);
    $post(['unit_price_fc' => '10.50'])->assertStatus(422)->assertJsonValidationErrors(['lines.0.unit_price_fc']);
    $post(['discount_pct' => '100'])->assertCreated()->assertJsonPath('data.total_fc.amount', 0);
    $this->postJson($this->api('invoices'), ['contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'due_date' => '2026-03-01', 'lines' => [$line([])]], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['due_date']);
    $this->postJson($this->api('invoices'), ['contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => []], $this->key())->assertStatus(422)->assertJsonValidationErrors(['lines']);
    // A supplier cannot be invoiced, and a customer cannot be billed.
    $this->postJson($this->api('invoices'), $this->t->body($this->t->supplier, [[1000, '1']]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_kind_invalid']);
    $this->postJson($this->api('bills'), $this->t->body($this->t->customer, [[1000, '1', null, null, '5000']]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_kind_invalid']);
    // Sales documents take no withholding code; a kind of the other family is refused.
    $this->postJson($this->api('invoices'), [...$this->t->body($this->t->customer, [[1000, '1']]), 'wht_code_id' => $this->t->tax['WHT10']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['wht_code_id']);
    $this->postJson($this->api('invoices'), [...$this->t->body($this->t->customer, [[1000, '1']]), 'kind' => 'purchase_bill'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['kind']);
    // A withholding code is no line tax.
    $this->postJson($this->api('bills'), $this->t->body($this->t->supplier, [[1000, '1', 'WHT10', null, '5000']]), $this->key())->assertStatus(422)->assertJson(['code' => 'tax_code_invalid']);
});

it('lists pending invoices and bills in the approvals inbox, but not for the person who sent them', function (): void {
    $this->workflow('invoice');
    // The maker also holds the approver role: maker ≠ checker must still keep it out of their inbox.
    $maker = $this->person('Both Roles', ['Accountant', 'Approver']);
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[5000, '2', 'VAT10']]), $maker);
    $this->submitDoc('invoices', $doc['id'], $maker);

    $this->asPerson($maker, signing: true)->getJson($this->api('approvals'))->assertOk()->assertJsonCount(0, 'data');
    $approver = $this->person('Abe Approver', ['Approver']);
    $this->asPerson($approver, signing: true)->getJson($this->api('approvals'))->assertOk()->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.document_type', 'invoice')
        ->assertJsonPath('data.0.document.id', $doc['id'])
        ->assertJsonPath('data.0.document.kind', 'sales_invoice')
        ->assertJsonPath('data.0.document.amount.amount', 11000);

    $this->postJson($this->api("invoices/{$doc['id']}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    $this->getJson($this->api('approvals'))->assertJsonCount(0, 'data');
});
