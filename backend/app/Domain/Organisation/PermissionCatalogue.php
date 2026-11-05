<?php

declare(strict_types=1);

namespace App\Domain\Organisation;

/**
 * The permission grid's rows in plain language (plan 3c.25): every permission of the matrix grouped by module, each with a label a
 * bookkeeper understands. The list itself is always PermissionMatrix::permissions(): a permission added there shows up here even before
 * it has a label (the label is then made from its name), so the catalogue can never drift into offering a name the matrix does not have.
 * Pure PHP.
 */
final class PermissionCatalogue
{
    /** @var array<string, string> module key → label, in display order */
    private const array MODULES = [
        'journals' => 'Journals', 'invoices' => 'Sales invoices', 'receipts' => 'Customer receipts', 'contacts' => 'Customers and suppliers',
        'items' => 'Products and services', 'bills' => 'Purchase bills', 'payments' => 'Supplier payments',
        'purchase_requisitions' => 'Purchase requisitions', 'purchase_orders' => 'Purchase orders', 'goods_receipts' => 'Goods receipts',
        'banking' => 'Banking', 'recurring' => 'Recurring documents', 'budgets' => 'Budgets', 'reports' => 'Reports',
        'documents' => 'Sending documents', 'accounts' => 'Chart of accounts', 'dimensions' => 'Dimensions', 'tax' => 'Tax codes',
        'fx' => 'Exchange rates', 'periods' => 'Periods and year-end', 'settings' => 'Company settings', 'audit' => 'Audit trail',
    ];

    /** @var array<string, string> permission → label */
    private const array LABELS = [
        'journals.view' => 'See journals', 'journals.create' => 'Write journal drafts', 'journals.submit' => 'Submit journals for approval',
        'journals.approve' => 'Approve journals', 'journals.reverse' => 'Reverse posted journals',
        'invoices.view' => 'See invoices', 'invoices.create' => 'Write invoice drafts', 'invoices.submit' => 'Submit invoices for approval',
        'invoices.approve' => 'Approve invoices', 'invoices.void' => 'Cancel draft or pending invoices', 'invoices.void_own' => 'Cancel own draft invoices',
        'invoices.reverse' => 'Reverse posted invoices',
        'receipts.view' => 'See receipts', 'receipts.create' => 'Record customer receipts', 'receipts.reverse' => 'Reverse customer receipts',
        'contacts.view' => 'See customers and suppliers', 'contacts.manage' => 'Add and change customers and suppliers',
        'contacts.manage_customers' => 'Add and change customers only',
        'items.view' => 'See products and services', 'items.manage' => 'Add and change products and services',
        'bills.view' => 'See bills', 'bills.create' => 'Write bill drafts', 'bills.submit' => 'Submit bills for approval', 'bills.approve' => 'Approve bills',
        'bills.void' => 'Cancel draft or pending bills', 'bills.reverse' => 'Reverse posted bills', 'bills.match_override' => 'Override a failed three-way match',
        'payments.view' => 'See supplier payments', 'payments.create' => 'Pay bills', 'payments.approve' => 'Approve payments', 'payments.reverse' => 'Reverse payments',
        'purchase_requisitions.view' => 'See requisitions', 'purchase_requisitions.create' => 'Write requisitions', 'purchase_requisitions.submit' => 'Submit requisitions',
        'purchase_requisitions.approve' => 'Approve requisitions',
        'purchase_orders.view' => 'See purchase orders', 'purchase_orders.create' => 'Write purchase orders', 'purchase_orders.submit' => 'Submit purchase orders',
        'purchase_orders.approve' => 'Approve purchase orders', 'purchase_orders.cancel' => 'Cancel and close purchase orders',
        'goods_receipts.view' => 'See goods receipts', 'goods_receipts.create' => 'Record goods received', 'goods_receipts.reverse' => 'Reverse goods receipts',
        'banking.view' => 'See bank accounts and statements', 'banking.reconcile' => 'Reconcile bank accounts', 'banking.transactions.create' => 'Add bank transactions',
        'banking.rules.manage' => 'Manage bank rules',
        'recurring.view' => 'See recurring documents', 'recurring.manage' => 'Manage recurring documents',
        'budgets.view' => 'See budgets', 'budgets.manage' => 'Edit budgets', 'budgets.approve' => 'Approve budgets',
        'reports.view' => 'See reports', 'reports.export' => 'Export reports',
        'documents.send' => 'Email posted documents',
        'accounts.view' => 'See the chart of accounts', 'accounts.manage' => 'Change the chart of accounts',
        'dimensions.view' => 'See dimensions', 'dimensions.manage' => 'Change dimensions',
        'tax.view' => 'See tax codes', 'tax.manage' => 'Change tax codes',
        'fx.view' => 'See exchange rates', 'fx.manage' => 'Change exchange rates and run revaluation',
        'periods.view' => 'See periods', 'periods.close' => 'Close periods', 'periods.reopen.request' => 'Ask to reopen a closed period',
        'periods.reopen.approve' => 'Approve reopening a period', 'periods.year_end' => 'Run the year-end close',
        'periods.post_soft_closed' => 'Post into soft-closed periods', 'periods.post_adjustment' => 'Post year-end adjustments',
        'settings.view' => 'See company settings', 'settings.manage' => 'Change company settings, numbering and workflows',
        'audit.view' => 'See the audit trail', 'audit.verify' => 'Verify the audit chain',
    ];

    /**
     * @return list<array{key: string, label: string, permissions: list<array{name: string, label: string}>}>
     */
    public static function modules(): array
    {
        $byModule = [];
        foreach (PermissionMatrix::permissions() as $name) {
            $byModule[self::moduleOf($name)][] = ['name' => $name, 'label' => self::label($name)];
        }

        $out = [];
        foreach (self::MODULES as $key => $label) {
            if (isset($byModule[$key])) {
                $out[] = ['key' => $key, 'label' => $label, 'permissions' => $byModule[$key]];
                unset($byModule[$key]);
            }
        }
        foreach ($byModule as $key => $permissions) {
            $out[] = ['key' => $key, 'label' => self::humanise($key), 'permissions' => $permissions];
        }

        return $out;
    }

    public static function label(string $permission): string
    {
        return self::LABELS[$permission] ?? self::humanise(str_replace('.', ' ', $permission));
    }

    public static function moduleOf(string $permission): string
    {
        return explode('.', $permission, 2)[0];
    }

    private static function humanise(string $text): string
    {
        return ucfirst(trim(str_replace('_', ' ', $text)));
    }
}
