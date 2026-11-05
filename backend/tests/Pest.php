<?php

declare(strict_types=1);

use Tests\Support\AssetApi;
use Tests\Support\MakesApiCalls;
use Tests\Support\ProcurementApi;
use Tests\Support\ResetsDatabase;
use Tests\Support\TradeApi;
use Tests\Support\UploadsAttachments;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(ResetsDatabase::class)
    ->in('Feature', 'Database', 'Invariants', 'Concurrency', 'Api');

pest()->use(MakesApiCalls::class)->in('Api/Ledger', 'Api/Trade', 'Api/Files', 'Api/Recurring', 'Api/Settings', 'Api/Workflow', 'Api/Org', 'Api/Audit', 'Api/Procurement', 'Feature/FixedAssets', 'Invariants/FixedAssets');
pest()->use(TradeApi::class)->in('Api/Trade', 'Api/Files', 'Api/Recurring', 'Api/Settings', 'Api/Workflow', 'Api/Org', 'Api/Audit', 'Api/Procurement', 'Feature/FixedAssets', 'Invariants/FixedAssets');
pest()->use(ProcurementApi::class)->in('Api/Procurement');
pest()->use(AssetApi::class)->in('Feature/FixedAssets', 'Invariants/FixedAssets');
pest()->use(UploadsAttachments::class)->in('Api/Files');
