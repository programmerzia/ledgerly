<?php

declare(strict_types=1);

namespace App\Services\Ledger;

use App\Contracts\IdGenerator;
use App\Domain\Ledger\BalanceDelta;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\Violation;
use App\Events\Ledger\JournalPosted;
use App\Events\Ledger\JournalReversed;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use DateTimeImmutable;

/**
 * Posts, or reverses, several journals of one document in one go (13 §8): every journal goes through the PostingEngine
 * (validate, number, insert, flip to posted) and the balance deltas are merged into ONE sorted upsert at level 4, so two
 * legs of a document never take balance rows in conflicting orders. All journals must fall in the one period given, which
 * the caller has locked (level 1) and whose documents it holds (level 2).
 */
final class JournalSetPoster
{
    public function __construct(private readonly PostingEngine $engine, private readonly IdGenerator $ids) {}

    /**
     * @param  list<JournalDraft>  $drafts
     * @return list<Journal>
     */
    public function post(Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, FiscalPeriod $period, string $baseCurrency, array $drafts): array
    {
        $posted = [];
        $deltas = [];
        foreach ($drafts as $draft) {
            $ctx = $this->engine->context($actor, $draft, $period);
            $plan = $this->engine->decide($draft, $ctx, $period);
            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($draft->companyId, $key, $prefix);
            $journal = $this->engine->insertDraft($actor, $this->ids->next(), $draft, $baseCurrency, $period->id);
            $posted[] = $this->engine->markPosted($journal, $plan, $number, $period, $actor);
            $deltas = $this->merge($deltas, $plan->balanceDeltas);
            $audit->add('journal.posted', $journal, after: $journal);
            $outbox->add(new JournalPosted($journal->id, $journal->company_id, $number, $journal->lock_version));
        }
        $locks->balances($drafts[0]->companyId, $period->id, array_values($deltas));

        return $posted;
    }

    /**
     * Mirror journals (debits and credits swapped), all dated $date, which the caller has checked is in $period. The
     * originals are locked, posted, not themselves reversals; they become `reversed`.
     *
     * @param  list<Journal>  $originals
     * @return array<string, Journal> reversal by original id
     */
    public function reverse(Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, FiscalPeriod $period, string $baseCurrency, array $originals, DateTimeImmutable $date, ?string $memo = null): array
    {
        $out = [];
        $deltas = [];
        foreach ($originals as $doc) {
            if ($doc->status !== JournalStatus::Posted || $doc->reversal_of_id !== null) {
                throw PostingRejected::because([new Violation('journal_not_reversible', 'Only a posted journal can be reversed.')]);
            }
            $lines = array_values($doc->load('lines')->lines->map(fn ($l) => $l->toDraftLine($baseCurrency)->mirrored())->all());
            $draft = new JournalDraft(
                companyId: $doc->company_id, type: JournalType::Reversal, date: $date, lines: $lines,
                reference: 'Reversal of '.$doc->number, memo: $memo ?? $doc->memo, sourceType: $doc->source_type, sourceId: $doc->source_id,
                reversalOfDate: $doc->journal_date,
            );
            $ctx = $this->engine->context($actor, $draft, $period);
            $plan = $this->engine->decide($draft, $ctx, $period);
            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($doc->company_id, $key, $prefix);
            $reversal = $this->engine->insertDraft($actor, $this->ids->next(), $draft, $baseCurrency, $period->id, ['reversal_of_id' => $doc->id]);
            $reversal = $this->engine->markPosted($reversal, $plan, $number, $period, $actor);

            $before = $doc->attributesToArray();
            $doc->forceFill(['status' => JournalStatus::Reversed, 'reversed_by_id' => $reversal->id, 'lock_version' => $doc->lock_version + 1])->save();
            $deltas = $this->merge($deltas, $plan->balanceDeltas);
            $audit->add('journal.posted', $reversal, after: $reversal, context: ['reversal_of' => $doc->id]);
            $audit->add('journal.reversed', $doc, before: $before, after: $doc);
            $outbox->add(new JournalPosted($reversal->id, $reversal->company_id, $number, $reversal->lock_version));
            $outbox->add(new JournalReversed($doc->id, $doc->company_id, $reversal->id, $doc->lock_version));
            $out[$doc->id] = $reversal;
        }
        if ($out !== []) {
            $locks->balances($originals[0]->company_id, $period->id, array_values($deltas));
        }

        return $out;
    }

    /**
     * @param  array<string, BalanceDelta>  $into
     * @param  list<BalanceDelta>  $more
     * @return array<string, BalanceDelta>
     */
    private function merge(array $into, array $more): array
    {
        foreach ($more as $d) {
            $k = $d->accountId.'|'.bin2hex($d->dimKey());
            $into[$k] = isset($into[$k]) ? new BalanceDelta($d->accountId, $d->dims, $into[$k]->debit + $d->debit, $into[$k]->credit + $d->credit) : $d;
        }

        return $into;
    }
}
