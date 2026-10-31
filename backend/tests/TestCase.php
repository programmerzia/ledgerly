<?php

declare(strict_types=1);

namespace Tests;

use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Support\Testing\FrozenClock;
use App\Support\Testing\GrantedPermissions;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected FrozenClock $clock;

    protected function setUp(): void
    {
        parent::setUp();
        $this->clock = new FrozenClock('2026-03-15 09:30:00');
        $this->app->instance(Clock::class, $this->clock);
    }

    /** Grant the given company permissions to every actor (spatie arrives in plan step 1.5). */
    protected function grant(string ...$permissions): void
    {
        $this->app->instance(PermissionChecker::class, new GrantedPermissions(array_values($permissions)));
    }
}
