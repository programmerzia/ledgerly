<?php

declare(strict_types=1);

use App\Domain\Ledger\DraftLine;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * The same document hit by several processes at once: the document lock (level 2) serialises them,
 * the loser re-reads the committed state and is refused cleanly.
 */

it('posts one draft exactly once when several processes post it together', function (): void {
    $f = LedgerFixture::create();
    $draft = draftJournal($f, [new DraftLine($f->account('1000'), debit: 7700), new DraftLine($f->account('4000'), credit: 7700)]);

    $flat = Race::flatten(Race::run($f, array_fill(0, 6, [['op' => 'post', 'id' => $draft->id, 'user' => $f->userId]])));

    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(array_fill(0, 5, 'journal_not_postable'))
        ->and(DB::table('journals')->where('status', 'posted')->pluck('number')->all())->toBe(['JV-FY2026-00001'])
        ->and(DB::table('audit_events')->where('action', 'journal.posted')->count())->toBe(1)
        ->and(DB::table('outbox_messages')->where('type', 'journal.posted')->count())->toBe(1)
        ->and(balancesByCode($f))->toBe(['1000' => ['debit' => 7700, 'credit' => 0], '4000' => ['debit' => 0, 'credit' => 7700]])
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('reverses a posted journal exactly once when several processes reverse it together', function (): void {
    $f = LedgerFixture::create();
    $original = cashSale($f, 4200, '2026-03-10');

    $flat = Race::flatten(Race::run($f, array_fill(0, 5, [['op' => 'reverse', 'id' => $original->id, 'user' => $f->userId]])));

    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(array_fill(0, 4, 'journal_already_reversed'));

    $reversals = DB::table('journals')->where('reversal_of_id', $original->id)->get();
    expect($reversals)->toHaveCount(1)
        ->and(DB::table('journals')->where('id', $original->id)->value('reversed_by_id'))->toBe($reversals[0]->id)
        ->and(DB::table('journals')->where('id', $original->id)->value('status'))->toBe('reversed')
        ->and(DB::table('journals')->whereNotNull('number')->orderBy('number')->pluck('number')->all())->toBe(['JV-FY2026-00001', 'JV-FY2026-00002'])
        ->and(DB::table('audit_events')->where('action', 'journal.reversed')->count())->toBe(1)
        ->and(balancesByCode($f))->toBe(['1000' => ['debit' => 4200, 'credit' => 4200], '4000' => ['debit' => 4200, 'credit' => 4200]])
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
