<?php

declare(strict_types=1);

use Tests\Support\MakesApiCalls;
use Tests\Support\ResetsDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(ResetsDatabase::class)
    ->in('Feature', 'Database', 'Invariants', 'Concurrency', 'Api');

pest()->use(MakesApiCalls::class)->in('Api/Ledger');
