<?php

declare(strict_types=1);

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Ledger\DraftLine;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * Property-style: post seeded random valid journals (and some reversals), then run the 13 §9
 * detectives: every journal balances, projection = Σ lines, numbers gapless, audit chain intact.
 */
it('holds every ledger invariant after random postings', function (int $seed) {
    mt_srand($seed);
    $f = LedgerFixture::create();
    $this->grant('journals.reverse');
    $codes = ['1000', '1300', '4000', '5000'];
    $posted = [];

    for ($n = 0; $n < 40; $n++) {
        $lines = [];
        $total = 0;
        $debits = mt_rand(1, 3);
        for ($i = 0; $i < $debits; $i++) {
            $amount = mt_rand(1, 1_000_000);
            $total += $amount;
            $lines[] = new DraftLine($f->account($codes[mt_rand(0, 3)]), debit: $amount);
        }
        // split the credit side into 1..3 parts summing to $total
        $parts = mt_rand(1, 3);
        $remaining = $total;
        for ($i = 1; $i < $parts && $remaining > 1; $i++) {
            $cut = mt_rand(1, $remaining - 1);
            $lines[] = new DraftLine($f->account($codes[mt_rand(0, 3)]), credit: $cut);
            $remaining -= $cut;
        }
        $lines[] = new DraftLine($f->account($codes[mt_rand(0, 3)]), credit: $remaining);

        $date = sprintf('2026-%02d-%02d', mt_rand(1, 12), mt_rand(1, 28));
        $posted[] = postJournal($f, draftJournal($f, $lines, $date));
    }
    foreach (array_rand($posted, 8) as $i) {
        app(ReverseJournal::class)->handle($f->signedActor(), new ReverseJournalInput($posted[$i]->id));
    }

    // 1. every journal balances and matches its totals
    $unbalanced = DB::select(<<<'SQL'
        SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id = j.id
        WHERE j.status IN ('posted', 'reversed')
        GROUP BY j.id, j.total_debit, j.total_credit
        HAVING sum(l.debit) <> sum(l.credit) OR sum(l.debit) <> j.total_debit OR count(*) < 2
    SQL);
    expect($unbalanced)->toBe([]);

    // 2. balance projection equals Σ lines per (account, period)
    $drift = DB::select(<<<'SQL'
        WITH lines AS (
            SELECT l.account_id, j.fiscal_period_id, sum(l.debit) AS d, sum(l.credit) AS c
            FROM journal_lines l JOIN journals j ON j.id = l.journal_id
            WHERE j.status IN ('posted', 'reversed') GROUP BY 1, 2
        ), proj AS (
            SELECT account_id, fiscal_period_id, sum(debit) AS d, sum(credit) AS c FROM account_period_balances GROUP BY 1, 2
        )
        SELECT * FROM lines FULL JOIN proj USING (account_id, fiscal_period_id)
        WHERE lines.d IS DISTINCT FROM proj.d OR lines.c IS DISTINCT FROM proj.c
    SQL);
    expect($drift)->toBe([]);

    // 3. gapless numbering
    $numbers = DB::table('journals')->whereNotNull('number')->orderBy('number')->pluck('number')->all();
    expect($numbers)->toBe(array_map(fn ($i) => sprintf('JV-FY2026-%05d', $i), range(1, 48)));

    // 4. trial balance nets to zero
    expect((int) DB::table('account_period_balances')->sum(DB::raw('debit - credit')))->toBe(0);

    // 5. audit chain verifies end to end
    $prev = null;
    foreach (DB::table('audit_events')->orderBy('id')->cursor() as $e) {
        expect($e->prev_hash)->toBe($prev)->and($e->hash)->toBe(hash('sha256', ($prev ?? '').$e->canonical));
        $prev = $e->hash;
    }
})->with([7, 42, 2026]);
