<?php

declare(strict_types=1);

use App\Domain\Organisation\PermissionMatrix as M;

it('lists seven roles and no duplicate permissions', function () {
    expect(M::ROLES)->toHaveCount(7)->and(M::permissions())->toBe(array_values(array_unique(M::permissions())));
});

it('gives the approver approvals and views but no create rights', function () {
    $p = M::forRole(M::APPROVER);
    expect($p)->toContain('journals.approve', 'invoices.approve', 'bills.approve', 'payments.approve', 'journals.view', 'reports.export')
        ->and(array_filter($p, fn ($x) => str_ends_with($x, '.create')))->toBe([]);
});

it('keeps period control away from the accountant', function () {
    expect(M::forRole(M::ACCOUNTANT))->not->toContain('periods.close', 'periods.post_soft_closed', 'periods.post_adjustment')
        ->toContain('periods.reopen.request');
});

it('grants soft-closed and adjustment posting only to Owner and Finance Manager', function () {
    foreach (['periods.post_soft_closed', 'periods.post_adjustment'] as $perm) {
        $holders = array_values(array_filter(M::ROLES, fn ($r) => in_array($perm, M::forRole($r), true)));
        expect($holders)->toBe([M::OWNER, M::FINANCE_MANAGER]);
    }
});

it('lets only Owner and Auditor verify the audit chain, and Finance Manager view it', function () {
    $holders = array_values(array_filter(M::ROLES, fn ($r) => in_array('audit.verify', M::forRole($r), true)));
    expect($holders)->toBe([M::OWNER, M::AUDITOR])
        ->and(M::forRole(M::FINANCE_MANAGER))->toContain('audit.view')
        ->and(M::forRole(M::VIEWER))->not->toContain('audit.view');
});

it('limits the sales assistant to sales documents', function () {
    $p = M::forRole(M::SALES_ASSISTANT);
    expect($p)->toContain('invoices.create', 'invoices.submit', 'receipts.create', 'items.manage', 'invoices.void_own')
        ->not->toContain('bills.create', 'bills.view', 'journals.view', 'reports.view', 'invoices.void', 'contacts.manage');
});

it('makes the viewer read-only and the owner hold everything', function () {
    expect(array_filter(M::forRole(M::VIEWER), fn ($x) => ! str_ends_with($x, '.view')))->toBe([])
        ->and(M::forRole(M::OWNER))->toBe(M::permissions());
});
