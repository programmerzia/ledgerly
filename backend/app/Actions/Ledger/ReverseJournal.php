<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\InvoiceKind;
use App\Events\Ledger\JournalPosted;
use App\Events\Ledger\JournalReversed;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts a mirror journal and marks the original reversed (13 §9). Dating follows D3: the original
 * date when the actor may post there, else the first day of the next period open to the actor;
 * never before the original. Journals in the adjustment period reverse within it (D7).
 */
final class ReverseJournal
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly PermissionChecker $permissions,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, ReverseJournalInput $in): Journal
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a journal.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $original = Journal::query()->findOrFail($in->journalId);                       // unlocked
            $this->assertReversible($original, $in->whileLocked !== null);
            // Reversing posts (ADR-0004): a person needs the permission and a signing grant. Only the
            // system (auto-reversing runs) acts without one; the Action checks even though the policy did.
            if ($actor->type !== ActorType::System) {
                if (! $this->permissions->allows($actor, $in->permission, $original->company_id)) {
                    throw DomainRuleViolation::single('forbidden', "This needs the {$in->permission} permission.");
                }
                if (! $actor->hasSigningGrant) {
                    throw DomainRuleViolation::single('signature_required', 'Reversing needs your signing PIN.');
                }
            }
            $originalPeriod = FiscalPeriod::query()->findOrFail($original->fiscal_period_id);
            $inAdjustment = $originalPeriod->kind === 'adjustment';

            $date = $in->date ?? ($inAdjustment ? $original->journal_date : $this->defaultDate($actor, $original, $originalPeriod));
            $type = $inAdjustment ? $original->journal_type : JournalType::Reversal;

            // 1: original period (KEY SHARE, keeps it from closing mid-way) + target period.
            if ($inAdjustment) {
                $period = $locks->periodsById($original->company_id, [$originalPeriod->id])[0] ?? null;
            } else {
                $period = PostingEngine::periodContaining($locks->periodsForPost($original->company_id, [$original->journal_date, $date]), $date);
            }

            $doc = $locks->document($original, $in->lockVersion);                            // 2
            if ($doc->status !== JournalStatus::Posted || $doc->fiscal_period_id !== $original->fiscal_period_id) {
                throw new RetryUnitOfWork('Journal changed while locking.');
            }
            if ($in->whileLocked !== null) {
                ($in->whileLocked)($locks);
            }

            $company = Company::query()->findOrFail($doc->company_id);
            $lines = array_values($doc->load('lines')->lines->map(fn ($l) => $l->toDraftLine($company->base_currency)->mirrored())->all());
            /** @var list<DraftLine> $lines */
            $draft = new JournalDraft(
                companyId: $doc->company_id,
                type: $type,
                date: $date,
                lines: $lines,
                reference: 'Reversal of '.$doc->number,
                memo: $in->memo ?? $doc->memo,
                sourceType: $doc->source_type,
                sourceId: $doc->source_id,
                reversalOfDate: $doc->journal_date,
            );

            $ctx = $this->engine->context($actor, $draft, $period);
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the reversal date.')]);
            }
            $plan = $this->engine->decide($draft, $ctx, $period);

            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($doc->company_id, $key, $prefix);                    // 3

            $reversal = $this->engine->insertDraft($actor, $this->ids->next(), $draft, $company->base_currency, $period->id, ['reversal_of_id' => $doc->id]);
            $reversal = $this->engine->markPosted($reversal, $plan, $number, $period, $actor);

            $before = $doc->attributesToArray();
            $doc->forceFill([
                'status' => JournalStatus::Reversed,
                'reversed_by_id' => $reversal->id,
                'lock_version' => $doc->lock_version + 1,
            ])->save();

            $locks->balances($doc->company_id, $period->id, $plan->balanceDeltas);          // 4

            $audit->add('journal.posted', $reversal, after: $reversal, context: ['reversal_of' => $doc->id]);
            $audit->add('journal.reversed', $doc, before: $before, after: $doc);
            $outbox->add(new JournalPosted($reversal->id, $reversal->company_id, $number, $reversal->lock_version));
            $outbox->add(new JournalReversed($doc->id, $doc->company_id, $reversal->id, $doc->lock_version));

            return $reversal;
        });
    }

    private function assertReversible(Journal $journal, bool $viaDocument): void
    {
        if ($journal->status === JournalStatus::Reversed) {
            throw DomainRuleViolation::single('journal_already_reversed', 'The journal has already been reversed.');
        }
        if ($journal->status !== JournalStatus::Posted) {
            throw DomainRuleViolation::single('journal_not_reversible', 'Only posted journals can be reversed.');
        }
        if ($journal->reversal_of_id !== null) {
            throw DomainRuleViolation::single('journal_not_reversible', 'A reversal cannot itself be reversed; post a new journal.');
        }
        // An invoice's or bill's journal is undone through the document, which keeps the sub-ledger and the ledger in step.
        if ($viaDocument === false && in_array($journal->source_type, [...InvoiceKind::values(...InvoiceKind::cases()), 'settlement', 'credit_application'], true)) {
            throw DomainRuleViolation::single('journal_not_reversible', 'This journal belongs to a document; reverse the document instead.');
        }
    }

    /** D3 default: the original date if postable for this actor, else the next postable period's first day. */
    private function defaultDate(Actor $actor, Journal $original, FiscalPeriod $originalPeriod): DateTimeImmutable
    {
        if ($this->postableFor($actor, $originalPeriod)) {
            return $original->journal_date;
        }

        $candidates = FiscalPeriod::query()
            ->where('company_id', $original->company_id)
            ->where('kind', 'regular')
            ->where('starts_on', '>', $originalPeriod->ends_on->format('Y-m-d'))
            ->whereIn('status', [PeriodStatus::Open->value, PeriodStatus::SoftClosed->value])
            ->orderBy('starts_on')
            ->get();

        foreach ($candidates as $period) {
            if ($this->postableFor($actor, $period)) {
                return $period->starts_on;
            }
        }

        throw PostingRejected::because([new Violation('period_missing', 'No open period is available for the reversal.')]);
    }

    private function postableFor(Actor $actor, FiscalPeriod $period): bool
    {
        return match ($period->status) {
            PeriodStatus::Open => true,
            PeriodStatus::SoftClosed => ! $actor->isApiClient() && $this->permissions->allows($actor, 'periods.post_soft_closed', $period->company_id),
            default => false,
        };
    }
}
