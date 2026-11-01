<?php

declare(strict_types=1);

use App\Domain\Workflow\DocumentStatus;
use App\Models\Trade\Contact;
use App\Models\Trade\Settlement;
use App\Support\Files\AttachableTypes;

it('allows exactly the listed kinds of parent', function (): void {
    expect(AttachableTypes::names())->toBe(['journal', 'invoice', 'bill', 'contact', 'settlement'])
        ->and(AttachableTypes::find('payroll', 'c', 'i'))->toBeNull();
});

it('follows the kind of a settlement for the module, and the kind of a contact for the write right', function (): void {
    $receipt = (new Settlement)->forceFill(['kind' => 'receipt']);
    $payment = (new Settlement)->forceFill(['kind' => 'payment']);
    $refund = (new Settlement)->forceFill(['kind' => 'supplier_refund']);

    expect(AttachableTypes::viewPermission('settlement', $receipt))->toBe('receipts.view')
        ->and(AttachableTypes::writePermission('settlement', $receipt))->toBe('receipts.create')
        ->and(AttachableTypes::viewPermission('settlement', $payment))->toBe('payments.view')
        ->and(AttachableTypes::writePermission('settlement', $refund))->toBe('payments.create')
        ->and(AttachableTypes::writePermission('contact', (new Contact)->forceFill(['kind' => 'customer'])))->toBe('contacts.manage_customers')
        ->and(AttachableTypes::writePermission('contact', (new Contact)->forceFill(['kind' => 'both'])))->toBe('contacts.manage');
});

it('treats posted and reversed documents as evidence, drafts and voids not', function (): void {
    $statuses = [DocumentStatus::Draft, DocumentStatus::PendingApproval, DocumentStatus::Void, DocumentStatus::Posted, DocumentStatus::Reversed];
    $locked = array_map(fn (DocumentStatus $s) => AttachableTypes::isPosted((new Settlement)->forceFill(['status' => $s])), $statuses);

    expect($locked)->toBe([false, false, false, true, true])
        ->and(AttachableTypes::isPosted(new Contact))->toBeFalse();
});
