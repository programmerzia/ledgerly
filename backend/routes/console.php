<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// 13 §15 scheduler. Per-tenant work fans out through sysops.tenants_due_for, never a tenant loop.
Schedule::command('outbox:sweep')->everyTenSeconds()->withoutOverlapping()->onOneServer();
// Webhook deliveries that are due: first attempts that missed the queue, and every retry (stored next_retry_at).
Schedule::command('webhooks:sweep')->everyTenSeconds()->withoutOverlapping()->onOneServer();
Schedule::command('idempotency:purge')->hourly()->onOneServer();
Schedule::command('audit:seal')->dailyAt('01:30')->timezone('UTC')->onOneServer();
// ECB publishes around 16:00 CET; fetch after that, then retry pending FX revaluation reversals.
Schedule::command('fx:fetch-rates')->dailyAt('17:30')->timezone('Europe/Berlin')->onOneServer();
// Uploaded files whose scan is still pending: queue them again (scanner was down, or the sync queue skipped them).
Schedule::command('attachments:scan-pending')->everyMinute()->withoutOverlapping()->onOneServer();
