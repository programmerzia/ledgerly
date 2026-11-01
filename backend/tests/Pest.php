<?php

declare(strict_types=1);

use Tests\Support\MakesApiCalls;
use Tests\Support\ResetsDatabase;
use Tests\Support\TradeApi;
use Tests\Support\UploadsAttachments;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(ResetsDatabase::class)
    ->in('Feature', 'Database', 'Invariants', 'Concurrency', 'Api');

pest()->use(MakesApiCalls::class)->in('Api/Ledger', 'Api/Trade', 'Api/Files');
pest()->use(TradeApi::class)->in('Api/Trade', 'Api/Files');
pest()->use(UploadsAttachments::class)->in('Api/Files');
