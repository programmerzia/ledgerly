<?php

declare(strict_types=1);

/**
 * The company menu, as one list (plan 3c.24). `php artisan migrate` loads it through App\Support\Menu\MenuItemSeeder, which upserts by
 * `key`; to add or change an item, edit this file and add a migration that calls MenuItemSeeder::sync() again (the table is read-only to
 * the app role, so only a migration or deploy step writes it).
 *
 * Per section: `key`, `title` (null = untitled), `collapsed` (starts collapsed), `items`.
 * Per item: `key` (stable, unique), `label`, `icon` (a key the SPA maps to a component; an unknown key falls back to a plain icon),
 *   `route` (path under /{company}), `permissions` (the person needs ANY of them; [] = every member of the company),
 *   `module` (optional plan-gating key for later), `active` (false hides it everywhere).
 * A permission that no role holds simply hides the item, so a row can be added before its feature ships. The menu is convenience,
 * never security: the API still refuses what a role may not do.
 *
 * @return list<array{key: string, title: string|null, collapsed?: bool, items: list<array<string, mixed>>}>
 */
return [
    ['key' => 'main', 'title' => null, 'items' => [
        ['key' => 'dashboard', 'label' => 'Dashboard', 'icon' => 'layout-dashboard', 'route' => 'dashboard', 'permissions' => []],
        ['key' => 'approvals', 'label' => 'Approvals', 'icon' => 'check-square', 'route' => 'approvals', 'permissions' => ['journals.approve']],
    ]],
    ['key' => 'sales', 'title' => 'Sales', 'items' => [
        ['key' => 'invoices', 'label' => 'Invoices', 'icon' => 'file-spreadsheet', 'route' => 'invoices', 'permissions' => ['invoices.view']],
        ['key' => 'recurring_invoices', 'label' => 'Recurring invoices', 'icon' => 'repeat', 'route' => 'invoices/recurring', 'permissions' => ['recurring.view']],
        ['key' => 'customers', 'label' => 'Customers', 'icon' => 'building', 'route' => 'customers', 'permissions' => ['contacts.view']],
        ['key' => 'items', 'label' => 'Products & services', 'icon' => 'package', 'route' => 'items', 'permissions' => ['items.view']],
    ]],
    ['key' => 'purchases', 'title' => 'Purchases', 'items' => [
        ['key' => 'requisitions', 'label' => 'Requisitions', 'icon' => 'clipboard-list', 'route' => 'requisitions', 'permissions' => ['purchase_requisitions.view']],
        ['key' => 'purchase_orders', 'label' => 'Purchase orders', 'icon' => 'shopping-cart', 'route' => 'purchase-orders', 'permissions' => ['purchase_orders.view']],
        ['key' => 'goods_receipts', 'label' => 'Receipts', 'icon' => 'package-check', 'route' => 'goods-receipts', 'permissions' => ['goods_receipts.view']],
        ['key' => 'bills', 'label' => 'Bills', 'icon' => 'file-text', 'route' => 'bills', 'permissions' => ['bills.view']],
        ['key' => 'suppliers', 'label' => 'Suppliers', 'icon' => 'building', 'route' => 'suppliers', 'permissions' => ['contacts.view']],
        ['key' => 'payment_run', 'label' => 'Pay bills', 'icon' => 'coins', 'route' => 'payment-run', 'permissions' => ['payments.view']],
        ['key' => 'wht_certificates', 'label' => 'WHT certificates', 'icon' => 'shield-check', 'route' => 'wht-certificates', 'permissions' => ['payments.view']],
        ['key' => 'debit_notes', 'label' => 'Debit notes', 'icon' => 'file-text', 'route' => 'debit-notes', 'permissions' => ['bills.view']],
        ['key' => 'recurring_bills', 'label' => 'Recurring bills', 'icon' => 'repeat', 'route' => 'bills/recurring', 'permissions' => ['recurring.view']],
        ['key' => 'procurement_reports', 'label' => 'Procurement reports', 'icon' => 'bar-chart', 'route' => 'procurement/reports', 'permissions' => ['purchase_orders.view']],
    ]],
    ['key' => 'banking', 'title' => 'Banking', 'items' => [
        ['key' => 'bank_accounts', 'label' => 'Bank accounts', 'icon' => 'credit-card', 'route' => 'banking', 'permissions' => ['banking.view']],
        ['key' => 'bank_rules', 'label' => 'Bank rules', 'icon' => 'wand', 'route' => 'banking/rules', 'permissions' => ['banking.view']],
    ]],
    ['key' => 'reports', 'title' => 'Reports', 'items' => [
        ['key' => 'report_profit_and_loss', 'label' => 'Profit & loss', 'icon' => 'bar-chart', 'route' => 'reports/profit-and-loss', 'permissions' => ['reports.view']],
        ['key' => 'report_balance_sheet', 'label' => 'Balance sheet', 'icon' => 'bar-chart', 'route' => 'reports/balance-sheet', 'permissions' => ['reports.view']],
        ['key' => 'report_cash_flow', 'label' => 'Cash flow', 'icon' => 'bar-chart', 'route' => 'reports/cash-flow', 'permissions' => ['reports.view']],
        ['key' => 'report_aging', 'label' => 'Aged receivables & payables', 'icon' => 'bar-chart', 'route' => 'reports/aging', 'permissions' => ['reports.view']],
        ['key' => 'report_trial_balance', 'label' => 'Trial balance', 'icon' => 'bar-chart', 'route' => 'reports/trial-balance', 'permissions' => ['reports.view']],
        ['key' => 'report_customer_statement', 'label' => 'Customer statement', 'icon' => 'file-spreadsheet', 'route' => 'reports/customer-statement', 'permissions' => ['reports.view']],
        ['key' => 'report_supplier_statement', 'label' => 'Supplier statement', 'icon' => 'file-spreadsheet', 'route' => 'reports/supplier-statement', 'permissions' => ['reports.view']],
        ['key' => 'report_general_ledger', 'label' => 'General ledger', 'icon' => 'book-marked', 'route' => 'reports/general-ledger', 'permissions' => ['reports.view']],
        ['key' => 'report_tax_return', 'label' => 'VAT return', 'icon' => 'file-spreadsheet', 'route' => 'reports/tax-return', 'permissions' => ['reports.view']],
    ]],
    ['key' => 'accounting', 'title' => 'Accounting', 'collapsed' => true, 'items' => [
        ['key' => 'journals', 'label' => 'Journals', 'icon' => 'book-marked', 'route' => 'journals', 'permissions' => ['journals.view']],
        ['key' => 'recurring_journals', 'label' => 'Recurring journals', 'icon' => 'refresh-cw', 'route' => 'accounting/recurring', 'permissions' => ['recurring.view']],
        ['key' => 'accounts', 'label' => 'Chart of accounts', 'icon' => 'layers', 'route' => 'accounts', 'permissions' => ['accounts.view']],
        ['key' => 'fixed_assets', 'label' => 'Fixed assets', 'icon' => 'package', 'route' => 'assets', 'permissions' => ['fixed_assets.view'], 'module' => 'fixed_assets'],
        ['key' => 'budgets', 'label' => 'Budgets', 'icon' => 'bar-chart', 'route' => 'budgets', 'permissions' => ['budgets.view']],
        ['key' => 'fx_rates', 'label' => 'Exchange rates', 'icon' => 'coins', 'route' => 'fx-rates', 'permissions' => ['fx.view']],
        ['key' => 'periods', 'label' => 'Periods & close', 'icon' => 'calendar', 'route' => 'periods', 'permissions' => ['periods.view']],
        ['key' => 'tax', 'label' => 'Tax codes', 'icon' => 'percent', 'route' => 'tax', 'permissions' => ['tax.view']],
    ]],
    ['key' => 'settings', 'title' => 'Settings', 'collapsed' => true, 'items' => [
        ['key' => 'settings', 'label' => 'Settings', 'icon' => 'settings', 'route' => 'settings', 'permissions' => ['settings.view']],
        ['key' => 'import', 'label' => 'Import data', 'icon' => 'upload', 'route' => 'settings/import', 'permissions' => ['settings.manage', 'accounts.manage', 'contacts.manage', 'invoices.create', 'banking.reconcile', 'budgets.manage']],
        ['key' => 'audit_log', 'label' => 'Audit log', 'icon' => 'history', 'route' => 'audit-log', 'permissions' => ['audit.view']],
        ['key' => 'onboarding', 'label' => 'Company setup', 'icon' => 'clipboard-list', 'route' => 'onboarding', 'permissions' => []],
    ]],
];
