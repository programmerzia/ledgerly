<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// 13 §15 scheduler. Per-tenant work fans out through sysops.tenants_due_for, never a tenant loop.
Schedule::command('outbox:sweep')->everyTenSeconds()->withoutOverlapping()->onOneServer();
// Practice-overview figures flagged by posting and period events (13 §7), coalesced per tenant.
Schedule::command('kpi:refresh')->everyFifteenSeconds()->withoutOverlapping()->onOneServer();
// Webhook deliveries that are due: first attempts that missed the queue, and every retry (stored next_retry_at).
Schedule::command('webhooks:sweep')->everyTenSeconds()->withoutOverlapping()->onOneServer();
Schedule::command('idempotency:purge')->hourly()->onOneServer();
Schedule::command('audit:seal')->dailyAt('01:30')->timezone('UTC')->onOneServer();
// ECB publishes around 16:00 CET; fetch after that, then retry pending FX revaluation reversals.
Schedule::command('fx:fetch-rates')->dailyAt('17:30')->timezone('Europe/Berlin')->onOneServer();
// Uploaded files whose scan is still pending: queue them again (scanner was down, or the sync queue skipped them).
Schedule::command('attachments:scan-pending')->everyMinute()->withoutOverlapping()->onOneServer();
// Recurring invoices, bills and journals that are due become drafts (never posted); each company's own date applies.
Schedule::command('recurring:run')->dailyAt('02:00')->timezone('UTC')->onOneServer();
// Documents that have waited on an approval step past their workflow's reminder time (plan 3c.7); once per interval, unique in the database.
Schedule::command('approvals:remind')->hourly()->onOneServer();
// Overdue-invoice reminders for companies that switched them on (plan 3c.7); each company's own date applies.
Schedule::command('dunning:run')->dailyAt('06:00')->timezone('UTC')->onOneServer();
