<?php

declare(strict_types=1);

use App\Actions\Imports\CreateImport;
use App\Actions\Imports\Inputs\CreateImportInput;
use App\Actions\Imports\Inputs\SetMappingInput;
use App\Actions\Imports\PreviewImport;
use App\Actions\Imports\RequestImportApply;
use App\Actions\Imports\SetImportMapping;
use App\Domain\Imports\ParsedSheet;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * Imports applied from several processes at once. The import row lock decides who queues it, the claim decides who runs it, and the
 * per-row lock plus the "valid" status decide who writes a row: exactly one result however many callers there are.
 */

/** @return array{0: string, 1: Actor} a previewed contacts import of three rows (codes P-1..P-3) and the person who made it */
function previewedContacts(LedgerFixture $f, string $owner): array
{
    $actor = new Actor(ActorType::User, $owner, $f->tenantId, $f->companyId, hasSigningGrant: true, requestId: 'test');
    $sheet = new ParsedSheet('csv', ['Code', 'Name'], [2 => ['Code' => 'P-1', 'Name' => 'One'], 3 => ['Code' => 'P-2', 'Name' => 'Two'], 4 => ['Code' => 'P-3', 'Name' => 'Three']]);
    $import = app(CreateImport::class)->handle($actor, new CreateImportInput($f->companyId, 'contacts', $sheet, 'race.csv'));
    $import = app(SetImportMapping::class)->handle($actor, $import->id, $import->lock_version, new SetMappingInput(['code' => 'Code', 'name' => 'Name']));

    return [app(PreviewImport::class)->handle($actor, $import->id)->id, $actor];
}

/** @return string a previewed opening-balance import: Dr cash 100.00 / Cr retained earnings 100.00 */
function previewedOpening(LedgerFixture $f, Actor $actor): string
{
    $sheet = new ParsedSheet('csv', ['Account', 'Debit', 'Credit'], [2 => ['Account' => '1000', 'Debit' => '100.00', 'Credit' => ''], 3 => ['Account' => '3000', 'Debit' => '', 'Credit' => '100.00']]);
    $import = app(CreateImport::class)->handle($actor, new CreateImportInput($f->companyId, 'opening_balances', $sheet, 'tb.csv', ['as_of' => '2026-01-01']));
    $import = app(SetImportMapping::class)->handle($actor, $import->id, $import->lock_version, new SetMappingInput(['account' => 'Account', 'debit' => 'Debit', 'credit' => 'Credit']));

    return app(PreviewImport::class)->handle($actor, $import->id)->id;
}

it('queues an import once however many apply requests arrive together', function (int $callers): void {
    $this->grant('contacts.manage', 'contacts.manage_customers');
    $f = LedgerFixture::create();
    $owner = Race::user($f, 'Olive');
    [$id] = previewedContacts($f, $owner);

    $flat = Race::flatten(Race::run($f, array_map(fn () => [['op' => 'import_apply', 'id' => $id, 'user' => $owner]], range(1, $callers))));

    expect(Race::errors($flat))->toBe([], 'a raw error surfaced to a caller')
        ->and(Race::refusals($flat))->toBe([])
        ->and(count(Race::ok($flat)))->toBe($callers, 'every caller is answered')
        ->and(DB::table('imports')->where('id', $id)->value('status'))->toBe('queued')
        ->and(DB::table('audit_events')->where('action', 'import.apply_requested')->count())->toBe(1, 'one request took effect')
        ->and(DB::table('imports')->where('id', $id)->value('lock_version'))->toBe(3, 'upload 0, mapping 1, preview 2, apply 3: no second apply');
})->with(['two requests' => [2], 'four requests' => [4]])->group('concurrency');

it('writes each row once when several workers run the same import', function (bool $retry): void {
    $this->grant('contacts.manage', 'contacts.manage_customers');
    $f = LedgerFixture::create();
    $owner = Race::user($f, 'Olive');
    [$id, $actor] = previewedContacts($f, $owner);
    app(RequestImportApply::class)->handle($actor, $id);

    $flat = Race::flatten(Race::run($f, array_map(fn () => [['op' => 'import_job', 'id' => $id, 'user' => $owner, 'retry' => $retry]], range(1, 3))));

    expect(Race::errors($flat))->toBe([], 'a raw error (unique violation, deadlock) surfaced')
        ->and(DB::table('contacts')->whereIn('code', ['P-1', 'P-2', 'P-3'])->count())->toBe(3)
        ->and(DB::table('import_rows')->where('import_id', $id)->where('status', 'applied')->count())->toBe(3)
        ->and(DB::table('imports')->where('id', $id)->value('status'))->toBe('completed')
        ->and(DB::table('imports')->where('id', $id)->value('rows_applied'))->toBe(3);
    if (! $retry) {
        // Without a retry flag only the worker that claimed the import runs it.
        expect(DB::table('audit_events')->where('action', 'import.applied')->count())->toBe(1);
    }
})->with(['plain workers' => [false], 'workers all retrying' => [true]])->group('concurrency');

it('posts one opening journal when two opening imports race, and the other ends refused', function (): void {
    $this->grant('settings.manage');
    $f = LedgerFixture::create();
    $owner = Race::user($f, 'Olive');
    $actor = new Actor(ActorType::User, $owner, $f->tenantId, $f->companyId, hasSigningGrant: true, requestId: 'test');
    $a = previewedOpening($f, $actor);
    $b = previewedOpening($f, $actor);

    // Both ask to apply at once; then both jobs run at once.
    $requests = Race::flatten(Race::run($f, [[['op' => 'import_apply', 'id' => $a, 'user' => $owner]], [['op' => 'import_apply', 'id' => $b, 'user' => $owner]]]));
    expect(Race::errors($requests))->toBe([]);
    $queued = DB::table('imports')->whereIn('id', [$a, $b])->where('status', 'queued')->pluck('id')->all();

    $jobs = Race::flatten(Race::run($f, array_map(fn (string $id) => [['op' => 'import_job', 'id' => $id, 'user' => $owner]], $queued)));

    expect(Race::errors($jobs))->toBe([], 'a raw error surfaced')
        ->and(DB::table('journals')->where('journal_type', 'opening')->where('status', 'posted')->count())->toBe(1)
        ->and(DB::table('imports')->whereIn('id', [$a, $b])->where('status', 'completed')->count())->toBe(1)
        ->and(DB::table('imports')->whereIn('id', [$a, $b])->whereIn('status', ['previewed', 'failed'])->count())->toBe(1)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
