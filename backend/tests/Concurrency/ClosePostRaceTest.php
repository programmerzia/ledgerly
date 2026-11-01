<?php

declare(strict_types=1);

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * 13 §8: a post takes the period FOR KEY SHARE and reads its status from the locked row; a close
 * takes FOR UPDATE and runs its checks after. So every racing post is either seen by the close
 * (committed before it) or refused `period_closed`, and nobody sees a deadlock.
 */

it('lets a close see every post that beat it and refuses every post behind it', function (): void {
    $f = LedgerFixture::create();
    $march = $f->period('2026-03-15')->id;
    $drafts = [];
    for ($i = 1; $i <= 40; $i++) {
        $drafts[] = draftJournal($f, [new DraftLine($f->account('1000'), debit: $i), new DraftLine($f->account('4000'), credit: $i)], sprintf('2026-03-%02d', 1 + $i % 28))->id;
    }

    $posters = array_map(fn (array $chunk) => array_map(fn (string $id) => ['op' => 'post', 'id' => $id, 'user' => $f->userId, 'delay_ms' => random_int(0, 40)], $chunk), array_chunk($drafts, 10));
    // The close lands somewhere in the middle of the posting run; where, varies from run to run.
    $closer = [['op' => 'close', 'id' => $march, 'user' => $f->userId, 'delay_ms' => random_int(20, 300), 'waivers' => ['DRAFTS' => 'race: drafts left behind are refused, not stranded']]];

    $flat = Race::flatten(Race::run($f, [$closer, ...$posters]));

    $closes = array_values(array_filter($flat, fn ($r) => $r['op'] === 'close'));
    $posts = array_values(array_filter($flat, fn ($r) => $r['op'] === 'post'));
    expect(Race::errors($flat))->toBe([], 'a deadlock or any other raw error surfaced to the caller')
        ->and($closes)->toHaveCount(1)->and($closes[0])->toHaveKey('ok')
        ->and($posts)->toHaveCount(40);

    $posted = array_values(array_filter($posts, fn ($r) => isset($r['ok'])));
    $refused = array_values(array_filter($posts, fn ($r) => isset($r['refused'])));
    expect(array_unique(array_column($refused, 'refused')))->each->toBe('period_closed')
        ->and(count($posted) + count($refused))->toBe(40);

    // The close recorded exactly the drafts that were still unposted when it ran, and those are the refused ones.
    $seen = json_decode((string) DB::table('period_close_checks')->where('fiscal_period_id', $march)->where('check_code', 'DRAFTS')->value('detail'), true)['journal_ids'];
    $stillDraft = DB::table('journals')->where('status', 'draft')->pluck('id')->all();
    sort($seen);
    sort($stillDraft);
    $postedIds = DB::table('journals')->where('status', 'posted')->pluck('id')->all();
    expect($seen)->toBe($stillDraft)
        ->and(count($postedIds))->toBe(count($posted))
        ->and(array_intersect($seen, $postedIds))->toBe([])
        ->and(DB::table('fiscal_periods')->where('id', $march)->value('status'))->toBe('closed')
        ->and(LedgerChecks::problems())->toBe([]);
    fwrite(STDERR, sprintf("[close-vs-post] posted %d, refused %d\n", count($posted), count($refused)));
})->group('concurrency');

it('closes the year while adjustments post into the adjustment period, and the closing journal covers exactly the earlier ones', function (): void {
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment');
    $f = LedgerFixture::create();
    $signer = new Actor(ActorType::User, $f->userId, $f->tenantId, $f->companyId, hasSigningGrant: true);
    cashSale($f, 10000, '2026-02-10');
    postJournal($f, draftJournal($f, [new DraftLine($f->account('5000'), debit: 4000), new DraftLine($f->account('1000'), credit: 4000)], '2026-05-10'));
    foreach (range(1, 12) as $m) {
        app(ClosePeriod::class)->handle($signer, new ClosePeriodInput($f->period(sprintf('2026-%02d-15', $m))->id));
    }
    $adjustment = $f->adjustmentPeriod();
    $yearId = $f->period('2026-01-15')->fiscal_year_id;

    $drafts = [];
    for ($i = 1; $i <= 30; $i++) {
        $drafts[] = draftJournal($f, [new DraftLine($f->account('5000'), debit: 100 * $i), new DraftLine($f->account('1300'), credit: 100 * $i)], '2026-12-31', JournalType::Adjustment, $adjustment->id)->id;
    }
    $posters = array_map(fn (array $chunk) => array_map(fn (string $id) => ['op' => 'post', 'id' => $id, 'user' => $f->userId, 'delay_ms' => random_int(0, 40)], $chunk), array_chunk($drafts, 10));
    $closer = [['op' => 'year_end', 'id' => $yearId, 'user' => $f->userId, 'delay_ms' => random_int(20, 300)]];

    $flat = Race::flatten(Race::run($f, [$closer, ...$posters]));

    expect(Race::errors($flat))->toBe([], 'a deadlock or any other raw error surfaced to the caller')
        ->and(Race::refusals($flat))->toBe([], 'the adjustment period stays open for audit adjustments after the year-end close (D7)')
        ->and(Race::ok($flat))->toHaveCount(31);

    $closing = DB::table('journals')->where('journal_type', 'closing')->where('status', 'posted')->whereNull('reversal_of_id')->first();
    expect($closing)->not->toBeNull()
        ->and(DB::table('journals')->where('journal_type', 'closing')->count())->toBe(1)
        ->and(DB::table('fiscal_years')->where('id', $yearId)->value('status'))->toBe('closed');

    // Postings that committed before the year-end lock carry lower numbers: the closing journal must
    // cover exactly those, and none of the ones that waited behind it.
    $before = DB::table('journals as j')->join('journal_lines as l', 'l.journal_id', '=', 'j.id')->join('accounts as a', 'a.id', '=', 'l.account_id')
        ->where('j.number', '<', $closing->number)->where('j.journal_type', '<>', 'closing')->whereIn('j.status', ['posted', 'reversed'])
        ->whereIn('a.account_type', ['income', 'expense'])->groupBy('l.account_id')->selectRaw('l.account_id, sum(l.debit) - sum(l.credit) AS net')->pluck('net', 'account_id')->all();
    $closedBy = DB::table('journal_lines')->where('journal_id', $closing->id)->whereIn('account_id', array_keys($before))->selectRaw('account_id, sum(credit) - sum(debit) AS net')->groupBy('account_id')->pluck('net', 'account_id')->all();
    expect(array_map('intval', $closedBy))->toEqual(array_map('intval', $before))
        ->and(LedgerChecks::problems())->toBe([]);

    $after = DB::table('journals')->where('journal_type', 'adjustment')->where('number', '>', $closing->number)->count();
    fwrite(STDERR, sprintf("[year-end-vs-post] adjustments before the closing journal %d, after %d\n", 30 - $after, $after));
})->group('concurrency');
