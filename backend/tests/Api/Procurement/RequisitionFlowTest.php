<?php

declare(strict_types=1);

/*
 * Purchase requisitions over HTTP (D14): the server totals the estimate, approval gives the gapless number, a requisition
 * is converted into a draft order line by line, and nothing here ever reaches the ledger.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('totals a draft on the server and ignores a client-sent total', function (): void {
    $body = $this->reqBody([[5000, '2'], [1250, '3', 'Pens']]) + ['total' => 1, 'lines_total' => 1];
    $body['lines'][0] += ['line_total' => 1];

    $this->asPerson($this->accountant)->postJson($this->api('purchase-requisitions'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)->assertJsonPath('data.currency', 'USD')
        ->assertJsonPath('data.total.amount', 13750)->assertJsonPath('data.total.currency', 'USD')
        ->assertJsonPath('data.lines.0.line_no', 1)->assertJsonPath('data.lines.0.line_total.amount', 10000)
        ->assertJsonPath('data.lines.0.quantity', '2.000000')->assertJsonPath('data.lines.0.estimated_unit_price.amount', 5000)
        ->assertJsonPath('data.lines.1.line_total.amount', 3750)->assertJsonPath('data.lines.0.purchase_order', null)
        ->assertJsonPath('data.version', 0)->assertJsonPath('data.can.update', true)->assertJsonPath('data.can.approve', false);
    expect($this->journalCount())->toBe(0);
});

it('refuses a requisition with no lines or a line with neither item nor description', function (): void {
    $this->asPerson($this->accountant)->postJson($this->api('purchase-requisitions'), [...$this->reqBody(), 'lines' => []], $this->key())->assertStatus(422);

    $body = $this->reqBody();
    unset($body['lines'][0]['description']);
    $this->asPerson($this->accountant)->postJson($this->api('purchase-requisitions'), $body, $this->key())->assertStatus(422)->assertJsonPath('code', 'requisition_line_empty');
});

it('refuses an update on a stale version with the server version', function (): void {
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $body = [...$this->reqBody([[9000, '1']]), 'version' => $pr['version']];

    $updated = $this->asPerson($this->accountant)->putJson($this->api("purchase-requisitions/{$pr['id']}"), $body, $this->key())->assertOk()
        ->assertJsonPath('data.version', 1)->assertJsonPath('data.total.amount', 9000)->json('data');

    $this->putJson($this->api("purchase-requisitions/{$pr['id']}"), [...$body, 'version' => 0], $this->key())->assertStatus(409)
        ->assertJsonPath('code', 'version_conflict')->assertJsonPath('server_version', $updated['version']);
});

it('goes pending on submit when a workflow applies, and a second person approves with a PIN to get PR-2026-00001', function (): void {
    $this->workflow('purchase_requisition');
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());

    $pending = $this->submitDoc('purchase-requisitions', $pr['id']);
    expect($pending['status'])->toBe('pending_approval')->and($pending['number'])->toBeNull();

    $approved = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.number', 'PR-2026-00001')->json('data');
    expect($approved['approved_by'])->toBe($this->approver->id)->and($this->journalCount())->toBe(0);
});

it('does not let the maker approve and asks for a signature', function (): void {
    $this->workflow('purchase_requisition');
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pr['id']);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertOk();

    $other = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $other['id']);
    $this->asPerson($this->approver)->postJson($this->api("purchase-requisitions/{$other['id']}/approve"), [], $this->key())->assertForbidden()->assertJsonPath('code', 'signature_required');
});

it('lets a maker who is also an approver still not approve their own requisition', function (): void {
    $this->workflow('purchase_requisition');
    $pr = $this->asPerson($this->owner)->postJson($this->api('purchase-requisitions'), $this->reqBody(), $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-requisitions', $pr['id'], $this->owner);

    $this->asPerson($this->owner, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertForbidden();
});

it('rejects a pending requisition for good, with a reason, by someone other than the maker', function (): void {
    $this->workflow('purchase_requisition');
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pr['id']);

    $this->asPerson($this->approver)->postJson($this->api("purchase-requisitions/{$pr['id']}/reject"), [], $this->key())->assertStatus(422);
    $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/reject"), ['reason' => 'No budget'], $this->key())->assertForbidden();

    $this->asPerson($this->approver)->postJson($this->api("purchase-requisitions/{$pr['id']}/reject"), ['reason' => 'No budget'], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.rejection_reason', 'No budget')->assertJsonPath('data.can.update', false);
    $this->getJson($this->api("purchase-requisitions/{$pr['id']}"))->assertJsonPath('data.status', 'rejected');
});

it('returns a pending requisition to draft with a comment', function (): void {
    $this->workflow('purchase_requisition');
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pr['id']);

    $this->asPerson($this->approver)->postJson($this->api("purchase-requisitions/{$pr['id']}/return"), ['comment' => 'Add detail'], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'draft');
    $this->asPerson($this->accountant)->getJson($this->api("purchase-requisitions/{$pr['id']}"))->assertJsonPath('data.can.update', true);
});

it('voids a draft or pending requisition', function (): void {
    $draft = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$draft['id']}/void"), ['reason' => 'Duplicate'], $this->key())->assertOk()->assertJsonPath('data.status', 'void');

    $this->workflow('purchase_requisition');
    $pending = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pending['id']);
    $this->asPerson($this->approver)->postJson($this->api("purchase-requisitions/{$pending['id']}/void"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
});

it('approves at once when there is no workflow and the submitter has a PIN grant', function (): void {
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());

    $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/submit"), [], $this->key())->assertForbidden()->assertJsonPath('code', 'signature_required');
    $done = $this->submitDoc('purchase-requisitions', $pr['id']);

    expect($done['status'])->toBe('approved')->and($done['number'])->toBe('PR-2026-00001')->and($this->journalCount())->toBe(0);
});

it('lets a viewer see requisitions but not create one', function (): void {
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $viewer = $this->person('Vic Viewer', ['Viewer']);

    $this->asPerson($viewer)->getJson($this->api('purchase-requisitions'))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->api("purchase-requisitions/{$pr['id']}"))->assertOk()->assertJsonPath('data.can.update', false);
    $this->postJson($this->api('purchase-requisitions'), $this->reqBody(), $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->getJson($this->api('purchase-requisitions'))->assertForbidden();
});

it('converts approved lines into a draft order linked to them, with the estimate as the price', function (): void {
    $pr = $this->approvedRequisition($this->reqBody([[5000, '2'], [1250, '3', 'Pens']]));
    $lineIds = array_column($pr['lines'], 'id');

    $order = $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $lineIds[0]], ['requisition_line_id' => $lineIds[1]]],
    ], $this->key())->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)
        ->assertJsonPath('data.lines.0.unit_price_fc.amount', 5000)->assertJsonPath('data.lines.0.requisition_line_id', $lineIds[0])
        ->assertJsonPath('data.lines.1.requisition_line_id', $lineIds[1])->assertJsonPath('data.total_fc.amount', 13750)->json('data');

    $this->getJson($this->api("purchase-requisitions/{$pr['id']}"))->assertJsonPath('data.lines.0.purchase_order.id', $order['id'])->assertJsonPath('data.lines.0.purchase_order.number', null);
    expect($this->journalCount())->toBe(0);
});

it('refuses to convert a line twice, and frees it when the order is cancelled', function (): void {
    $pr = $this->approvedRequisition();
    $line = $pr['lines'][0]['id'];
    $convert = fn () => $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $line]],
    ], $this->key());

    $first = $convert()->assertCreated()->json('data');
    $convert()->assertStatus(422)->assertJsonPath('code', 'requisition_line_converted');

    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$first['id']}/cancel"), ['reason' => 'Wrong supplier'], $this->key())->assertOk();
    $convert()->assertCreated();
});

it('asks for a price when the order is in a foreign currency', function (): void {
    $eur = $this->t->contact('S3', 'supplier', 'EUR');
    $this->t->rate('EUR', '2026-03-12', '1.10');
    $pr = $this->approvedRequisition();
    $line = $pr['lines'][0]['id'];

    $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $eur, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $line]],
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'line_price_missing');

    $this->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $eur, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $line, 'unit_price_fc' => 4000]],
    ], $this->key())->assertCreated()->assertJsonPath('data.currency', 'EUR')->assertJsonPath('data.total_fc.amount', 8000)->assertJsonPath('data.total.amount', 8800);
});

it('refuses to convert a requisition that is not approved', function (): void {
    $draft = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->workflow('purchase_requisition');
    $pending = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pending['id']);

    foreach ([$draft, $pending] as $pr) {
        $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
            'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $pr['lines'][0]['id']]],
        ], $this->key())->assertForbidden();
    }
});
