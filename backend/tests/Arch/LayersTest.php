<?php

declare(strict_types=1);

// 13 §4 layer rules.

arch('domain is pure PHP')
    ->expect('App\Domain')
    ->not->toUse(['Illuminate', 'App\Models', 'App\Support', 'App\Services', 'App\Actions', 'App\Http'])
    ->ignoring('App\Domain');

arch('domain does not read the wall clock')
    ->expect('App\Domain')
    ->not->toUse(['now', 'time', 'date', 'microtime']);

arch('actions never open transactions or touch the DB facade')
    ->expect('App\Actions')
    ->not->toUse(['Illuminate\Support\Facades\DB', 'DB']);

arch('actions do not read global auth or request state')
    ->expect('App\Actions')
    ->not->toUse(['auth', 'request', 'Illuminate\Support\Facades\Auth', 'Illuminate\Support\Facades\Request', 'Illuminate\Http\Request']);

arch('models carry no posting logic')
    ->expect('App\Models')
    ->not->toUse(['App\Actions', 'App\Services', 'App\Support\UnitOfWork']);

arch('strict types everywhere in app code')
    ->expect('App')
    ->toUseStrictTypes()
    ->ignoring('App\Providers');

arch('no debugging leftovers')
    ->expect(['dd', 'dump', 'ray', 'var_dump'])
    ->not->toBeUsed();

arch('the tax depreciation schedule never reaches the ledger')
    ->expect(['App\Domain\FixedAssets\TaxDepreciation', 'App\Queries\FixedAssets\TaxDepreciationSchedule', 'App\Actions\FixedAssets\ManageAssetTaxClass', 'App\Http\Controllers\FixedAssets\AssetTaxClassController'])
    ->not->toUse(['App\Actions\Ledger\RecordJournal', 'App\Actions\Ledger\PostJournal', 'App\Actions\Ledger\ReverseJournal', 'App\Services\Ledger', 'App\Models\Ledger\Journal', 'App\Models\Ledger\JournalLine', 'App\Services\FixedAssets\AssetJournals', 'App\Services\FixedAssets\AssetLedger']);

arch('policies only read: no Actions, no unit of work')
    ->expect('App\Policies')
    ->not->toUse(['App\Actions', 'App\Support\UnitOfWork', 'Illuminate\Support\Facades\DB']);
