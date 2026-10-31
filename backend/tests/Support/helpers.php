<?php

declare(strict_types=1);

use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use Tests\Support\LedgerFixture;

/** @param list<DraftLine> $lines */
function draftJournal(LedgerFixture $f, array $lines, string $date = '2026-03-15', JournalType $type = JournalType::Manual, ?string $periodId = null, ?Actor $actor = null): Journal
{
    return app(CreateJournalDraft::class)->handle($actor ?? $f->actor, new JournalDraftInput($f->companyId, $type, new DateTimeImmutable($date), $lines, 'REF', 'memo', $periodId));
}

function postJournal(LedgerFixture $f, Journal $journal, ?Actor $actor = null, ?int $version = null): Journal
{
    return app(PostJournal::class)->handle($actor ?? $f->actor, new PostJournalInput($journal->id, $version));
}

/** A simple cash sale: Dr 1000 Cash / Cr 4000 Sales. */
function cashSale(LedgerFixture $f, int $amount = 10000, string $date = '2026-03-15'): Journal
{
    return postJournal($f, draftJournal($f, [
        new DraftLine($f->account('1000'), debit: $amount),
        new DraftLine($f->account('4000'), credit: $amount),
    ], $date));
}

/** @return array<string, array{debit: int, credit: int}> account code → summed projection */
function balancesByCode(LedgerFixture $f): array
{
    $codes = array_flip($f->accounts);
    $out = [];
    foreach (DB::table('account_period_balances')->get() as $row) {
        $code = $codes[$row->account_id];
        $out[$code]['debit'] = ($out[$code]['debit'] ?? 0) + (int) $row->debit;
        $out[$code]['credit'] = ($out[$code]['credit'] ?? 0) + (int) $row->credit;
    }
    ksort($out);

    return $out;
}
