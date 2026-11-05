<?php

declare(strict_types=1);

namespace App\Domain\Organisation;

/**
 * The company permission matrix (13 §7), the single place it lives in code. Pure PHP.
 *
 * Narrow permissions the matrix describes in prose:
 *  - `contacts.manage_customers`: Sales Assistant's "customers" right; every `contacts.manage` role holds it too.
 *  - `invoices.void_own`: Sales Assistant's "own drafts" right; every `invoices.void` role holds it too.
 */
final class PermissionMatrix
{
    public const string OWNER = 'Owner';

    public const string FINANCE_MANAGER = 'Finance Manager';

    public const string ACCOUNTANT = 'Accountant';

    public const string APPROVER = 'Approver';

    public const string SALES_ASSISTANT = 'Sales Assistant';

    public const string VIEWER = 'Viewer';

    public const string AUDITOR = 'Auditor';

    public const array ROLES = [
        self::OWNER, self::FINANCE_MANAGER, self::ACCOUNTANT, self::APPROVER,
        self::SALES_ASSISTANT, self::VIEWER, self::AUDITOR,
    ];

    private const array MODULES = [
        'journals', 'invoices', 'bills', 'receipts', 'payments', 'contacts', 'items', 'banking', 'recurring',
        'periods', 'accounts', 'dimensions', 'tax', 'fx', 'settings', 'reports',
        'purchase_requisitions', 'purchase_orders', 'goods_receipts', 'transfers',
    ];

    private const array SALES_VIEWS = ['contacts.view', 'invoices.view', 'items.view', 'receipts.view'];

    private const array EXPORT = ['reports.export'];

    private const array DAILY = [
        'journals.create', 'journals.submit',
        'invoices.create', 'invoices.submit', 'receipts.create',
        'bills.create', 'bills.submit', 'payments.create',
        'contacts.manage', 'contacts.manage_customers', 'items.manage',
        'banking.reconcile', 'banking.transactions.create', 'banking.rules.manage',
        'recurring.manage',
        'invoices.void', 'invoices.void_own', 'bills.void',
        'periods.reopen.request',
        'purchase_requisitions.create', 'purchase_requisitions.submit', 'purchase_orders.create', 'purchase_orders.submit', 'goods_receipts.create',
        'transfers.create', 'transfers.submit', 'transfers.receive',
    ];

    private const array APPROVE = ['journals.approve', 'invoices.approve', 'bills.approve', 'payments.approve', 'purchase_requisitions.approve', 'purchase_orders.approve', 'transfers.approve'];

    private const array REVERSE = ['journals.reverse', 'invoices.reverse', 'bills.reverse', 'receipts.reverse', 'payments.reverse', 'purchase_orders.cancel', 'goods_receipts.reverse', 'bills.match_override', 'transfers.reverse'];

    private const array MANAGE = [
        'periods.close', 'periods.reopen.approve', 'periods.year_end', 'periods.post_soft_closed', 'periods.post_adjustment',
        'accounts.manage', 'dimensions.manage', 'tax.manage', 'fx.manage',
        'settings.manage',
    ];

    /** @return list<string> every permission name, deduplicated, in matrix order */
    public static function permissions(): array
    {
        return array_values(array_unique([
            ...self::views(), ...self::EXPORT, ...self::DAILY, ...self::APPROVE, ...self::REVERSE,
            ...self::MANAGE, 'audit.view', 'audit.verify',
        ]));
    }

    /** Added with procurement; existing companies got these from a backfill migration. */
    public static function isProcurement(string $permission): bool
    {
        return str_starts_with($permission, 'purchase_requisitions.') || str_starts_with($permission, 'purchase_orders.')
            || str_starts_with($permission, 'goods_receipts.') || $permission === 'bills.match_override';
    }

    /** Added by plan 3c.8 (fund transfers); existing companies got these from a backfill migration. */
    public static function isTransfers(string $permission): bool
    {
        return str_starts_with($permission, 'transfers.');
    }

    /** @return list<string> */
    public static function forRole(string $role): array
    {
        $all = self::permissions();

        return match ($role) {
            self::OWNER => $all,
            self::FINANCE_MANAGER => array_values(array_diff($all, ['audit.verify'])),
            self::ACCOUNTANT => [...self::views(), ...self::EXPORT, ...self::DAILY],
            self::APPROVER => [...self::views(), ...self::EXPORT, ...self::APPROVE],
            self::SALES_ASSISTANT => [
                ...self::SALES_VIEWS,
                'invoices.create', 'invoices.submit', 'receipts.create',
                'contacts.manage_customers', 'items.manage', 'invoices.void_own',
            ],
            self::VIEWER => self::views(),
            self::AUDITOR => [...self::views(), ...self::EXPORT, 'audit.view', 'audit.verify'],
            default => throw new \InvalidArgumentException("Unknown company role {$role}."),
        };
    }

    /** @return list<string> */
    private static function views(): array
    {
        return array_map(fn (string $m) => "{$m}.view", self::MODULES);
    }
}
