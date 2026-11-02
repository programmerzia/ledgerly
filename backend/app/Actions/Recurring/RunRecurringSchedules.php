<?php

declare(strict_types=1);

namespace App\Actions\Recurring;

use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Ledger\JournalType;
use App\Domain\Recurring\RecurrenceRule;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Workflow\RecurringOccurrenceCreated;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Platform\TenantUser;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringJournal;
use App\Models\Recurring\RecurringRun;
use App\Models\Recurring\RecurringSchedule;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Throwable;

/**
 * Creates every draft that is due up to `$asOf` (doc 14 E2; the mock's `runRecurringSchedules`), oldest first, and moves
 * each schedule's next date on. Missed runs are caught up, at most MAX_PER_SCHEDULE occurrences per schedule per call.
 *
 * Who does what. The caller is the system (the daily job) or a person pressing "run now" (`recurring.manage`). The drafts
 * are made by the schedule's owner (maker: `created_by`, and `submitted_by` later), through the normal Actions, so every
 * permission, validation and workflow rule applies. Nothing posts: a submit that would post immediately (no workflow
 * applies, so a signing PIN would be needed) is refused and the draft stays a draft.
 *
 * One occurrence is one UnitOfWork: the `recurring_runs` row (unique per schedule and date), the draft and the schedule's
 * move to its next date commit together. The unique key makes a second worker (or a repeated call) skip a date that is
 * already taken, even while the first is still in flight. Submitting is a second step, so a draft that cannot be
 * submitted (closed period, missing rate) is kept and reported instead of blocking the schedule.
 *
 * Lock order: the run row insert (the unique-index wait) comes first and serialises workers on one occurrence, so the
 * schedule row, updated last, is never contended by a second runner; a person editing a schedule takes only that row.
 */
final class RunRecurringSchedules
{
    public const int MAX_PER_SCHEDULE = 24;

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly PermissionChecker $permissions,
        private readonly CreateInvoiceDraft $invoices,
        private readonly CreateJournalDraft $journals,
        private readonly SubmitDocument $submit,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $companyId, DateTimeImmutable $asOf, ?string $scheduleId = null): RecurringRunSummary
    {
        if ($actor->type !== ActorType::System && ! $this->permissions->allows($actor, 'recurring.manage', $companyId) && ! $actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'This needs the recurring.manage permission.');
        }

        $runs = [];
        $failures = [];
        foreach ([RecurringInvoice::class, RecurringJournal::class] as $model) {
            $due = $model::query()->where('company_id', $companyId)->where('is_active', true)->where('next_date', '<=', $asOf)
                ->when($scheduleId !== null, fn ($q) => $q->whereKey($scheduleId))->orderBy('next_date')->orderBy('id')->get();
            foreach ($due as $schedule) {
                $this->runSchedule($actor, $schedule, $asOf, $runs, $failures);
            }
        }

        // Drafts whose submit never ran (a crash between the steps) get another try.
        foreach (RecurringRun::query()->where('company_id', $companyId)->where('status', 'drafted')
            ->when($scheduleId !== null, fn ($q) => $q->where('schedule_id', $scheduleId))->orderBy('id')->get() as $pending) {
            $this->submitDraft($actor, $pending);
        }

        return new RecurringRunSummary($runs, $failures);
    }

    /**
     * @param  list<RecurringRun>  $runs
     * @param  array<string, string>  $failures
     */
    private function runSchedule(Actor $actor, RecurringSchedule $schedule, DateTimeImmutable $asOf, array &$runs, array &$failures): void
    {
        $dates = RecurrenceRule::due($schedule->next_date, $schedule->frequency, $schedule->anchor_day, $asOf, $schedule->end_date, self::MAX_PER_SCHEDULE);

        foreach ($dates as $date) {
            try {
                $run = $this->createOccurrence($actor, $schedule, $date);
            } catch (UniqueConstraintViolationException) {
                break; // another worker took this date between our read and our insert; it moves the schedule on
            } catch (DomainRuleViolation $e) {
                $failures[$schedule->id] = $e->errorCode;
                $this->remember($schedule, $e->errorCode.': '.$e->getMessage());
                break;
            } catch (Throwable $e) {
                $failures[$schedule->id] = 'error';
                $this->remember($schedule, 'error: '.$e->getMessage());
                report($e);
                break;
            }
            if ($run === null) {
                break; // paused or moved on by someone else
            }
            $this->submitDraft($actor, $run);
            $runs[] = $run->refresh();
        }
    }

    /** The occurrence's transaction: run row, draft, schedule moved on. Null when the schedule is no longer due on $date. */
    private function createOccurrence(Actor $actor, RecurringSchedule $schedule, DateTimeImmutable $date): ?RecurringRun
    {
        $actor = new Actor($actor->type, $actor->id, $actor->tenantId, $schedule->company_id, ip: $actor->ip, userAgent: $actor->userAgent, requestId: $actor->requestId);

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $schedule, $date) {
            $current = $schedule::query()->find($schedule->id);
            if ($current === null || ! $current->is_active || $current->next_date->format('Y-m-d') !== $date->format('Y-m-d')) {
                return null;
            }
            $owner = $this->ownerActor($actor, $current);

            // First write: whoever has this date waits here, then fails on the unique key.
            $run = new RecurringRun;
            $run->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $current->company_id,
                'schedule_type' => $current->scheduleType(), 'schedule_id' => $current->id, 'occurrence_date' => $date,
                'document_type' => 'pending', 'document_id' => $current->id, 'status' => 'drafted',
            ])->save();

            [$documentType, $documentId] = match (true) {
                $current instanceof RecurringJournal => $this->journalDraft($owner, $current, $date),
                $current instanceof RecurringInvoice => $this->invoiceDraft($owner, $current, $date),
                default => throw new \LogicException('Unknown schedule type.'),
            };
            $run->forceFill(['document_type' => $documentType, 'document_id' => $documentId])->save();

            $next = RecurrenceRule::after($date, $current->frequency, $current->anchor_day);
            $finished = $current->end_date !== null && $next > $current->end_date;
            $before = $current->attributesToArray();
            $moved = $current::query()->whereKey($current->id)->where('next_date', $date)->update([
                'next_date' => $next, 'last_run_on' => $date, 'last_error' => null, 'is_active' => ! $finished,
                'lock_version' => $current->lock_version + 1, 'updated_at' => $this->clock->now(),
            ]);
            if ($moved !== 1) {
                throw DomainRuleViolation::single('recurring_moved', 'The schedule changed while it was running.');
            }
            $current->refresh();

            $audit->add('recurring_schedule.occurrence_created', $current, before: $before, after: $current, context: [
                'schedule_type' => $current->scheduleType(), 'occurrence_date' => $date->format('Y-m-d'), 'document_type' => $documentType, 'document_id' => $documentId,
                'owner_id' => $current->owner_id, 'finished' => $finished,
            ]);
            $outbox->add(new RecurringOccurrenceCreated($documentType, $documentId, $current->company_id, $current->scheduleType(), $current->id, $date->format('Y-m-d')));

            return $run;
        });
    }

    /** The owner as a person without a signing grant: permissions are theirs, and approving is never part of a run. */
    private function ownerActor(Actor $actor, RecurringSchedule $schedule): Actor
    {
        $active = TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $schedule->owner_id)->where('status', 'active')->exists();
        if (! $active) {
            throw DomainRuleViolation::single('recurring_owner_invalid', 'The schedule owner is no longer an active member of the organisation.');
        }

        return new Actor(ActorType::User, $schedule->owner_id, $actor->tenantId, $schedule->company_id, requestId: $actor->requestId ?? 'recurring:'.$schedule->id);
    }

    /** @return array{string, string} */
    private function invoiceDraft(Actor $owner, RecurringInvoice $schedule, DateTimeImmutable $date): array
    {
        $template = Invoice::query()->with('lines')->findOrFail($schedule->template_invoice_id);
        $lines = array_values($template->lines->map(function ($l): InvoiceLineInput {
            $dims = [];
            for ($p = 1; $p <= 8; $p++) {
                $value = $l->dimensionValue($p);
                if ($value !== null) {
                    $dims[$p] = $value;
                }
            }

            return new InvoiceLineInput(
                quantity: $l->quantity, itemId: $l->item_id, accountId: $l->account_id, description: $l->description, unitPriceFc: $l->unit_price_fc,
                discountPct: $l->discount_pct, taxCodeId: $l->tax_code_id, taxCodeGiven: true, dims: $dims,
            );
        })->all());

        // Due date and exchange rate are the server's: the contact's terms from this date, the rate in force on this date.
        $draft = $this->invoices->handle($owner, new InvoiceDraftInput(
            companyId: $schedule->company_id, kind: $template->kind, contactId: $template->contact_id, issueDate: $date, lines: $lines,
            currency: $template->currency, reference: $template->reference, memo: $template->memo,
            whtCodeId: $template->wht_code_id, whtCodeGiven: true,
        ));

        return [$draft->kind->documentType(), $draft->id];
    }

    /** @return array{string, string} */
    private function journalDraft(Actor $owner, RecurringJournal $schedule, DateTimeImmutable $date): array
    {
        $template = Journal::query()->with('lines')->findOrFail($schedule->template_journal_id);
        $base = Company::query()->findOrFail($schedule->company_id)->base_currency;
        $draft = $this->journals->handle($owner, new JournalDraftInput(
            companyId: $schedule->company_id, type: JournalType::Manual, date: $date,
            lines: array_values($template->lines->map(fn ($l) => $l->toDraftLine($base))->all()), reference: $template->reference, memo: $template->memo,
        ));

        return ['journal', $draft->id];
    }

    /** Step two: the normal submit path, by the owner. Kept as a draft, with the reason, when the submit is refused. */
    private function submitDraft(Actor $actor, RecurringRun $run): void
    {
        $schedule = ($run->schedule_type === 'recurring_journal' ? RecurringJournal::query() : RecurringInvoice::query())->find($run->schedule_id);
        if ($schedule === null) {
            return;
        }
        try {
            $owner = $this->ownerActor($actor, $schedule);
            // Overlapping runners can reach the same draft: the run row decides, and whoever finds it already
            // handled stops, so a refusal caused by the other runner's submit can't overwrite its status.
            $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($owner, $run): void {
                $locked = RecurringRun::query()->whereKey($run->id)->lockForUpdate()->firstOrFail();
                if ($locked->status === 'submitted') {
                    return;
                }
                $this->submit->handle($owner, new DocumentRef($run->document_type, $run->document_id));
                $locked->forceFill(['status' => 'submitted', 'note' => null])->save();
            });
        } catch (DomainRuleViolation $e) {
            RecurringRun::query()->whereKey($run->id)->where('status', '<>', 'submitted')
                ->update(['status' => 'submit_failed', 'note' => mb_substr($e->errorCode.': '.$e->getMessage(), 0, 500)]);
        }
    }

    private function remember(RecurringSchedule $schedule, string $message): void
    {
        $schedule::query()->whereKey($schedule->id)->update(['last_error' => mb_substr($message, 0, 500)]);
    }
}
