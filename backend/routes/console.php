<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// 13 §15 scheduler. Per-tenant work fans out through sysops.tenants_due_for, never a tenant loop.
Schedule::command('outbox:sweep')->everyTenSeconds()->withoutOverlapping()->onOneServer();
Schedule::command('idempotency:purge')->hourly()->onOneServer();
Schedule::command('audit:seal')->dailyAt('01:30')->timezone('UTC')->onOneServer();
