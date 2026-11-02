<?php

declare(strict_types=1);

namespace App\Actions\Recurring;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Recurring\Inputs\RecurringScheduleInput;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Platform\TenantUser;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringJournal;
use App\Models\Recurring\RecurringSchedule;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Creates, changes and pauses recurring schedules (`recurring.manage`). A schedule copies a posted template on each due
 * date into a draft owned by `owner` (the maker); this Action only keeps the schedule itself, `RunRecurringSchedules`
 * creates the drafts. The template cannot be swapped: a different template is a new schedule.
 */
final class ManageRecurringSchedule
{
    public const string INVOICE = 'invoice';

    public const string JOURNAL = 'journal';

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly PermissionChecker $permissions,
    ) {}

    public function create(Actor $actor, string $kind, RecurringScheduleInput $in): RecurringSchedule
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $kind, $in) {
            $this->guard->require($actor, 'recurring.manage', $in->companyId, tokens: true);
            $owner = $in->ownerId ?? ($actor->type === ActorType::User ? $actor->id : null)
                ?? throw DomainRuleViolation::single('recurring_owner_required', 'Name the person who owns the drafts this schedule creates.');
            $templateId = $in->templateId ?? throw DomainRuleViolation::single('recurring_template_required', 'Choose the posted document to copy.');
            $documentType = $this->checkTemplate($kind, $in->companyId, $templateId);
            $this->checkOwner($actor, $owner, $in->companyId, $documentType);
            $this->checkDates($in->nextDate, $in->endDate);

            $schedule = $kind === self::JOURNAL ? new RecurringJournal : new RecurringInvoice;
            $schedule->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'name' => $in->name,
                $kind === self::JOURNAL ? 'template_journal_id' : 'template_invoice_id' => $templateId,
                ...$this->columns($in), 'owner_id' => $owner, 'is_active' => true, 'lock_version' => 0,
            ])->save();
            $schedule->refresh();
            $audit->add('recurring_schedule.created', $schedule, after: $schedule, context: ['document_type' => $documentType]);

            return $schedule;
        });
    }

    public function update(Actor $actor, string $kind, string $id, int $version, RecurringScheduleInput $in): RecurringSchedule
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $kind, $id, $version, $in) {
            $schedule = $locks->document($this->find($kind, $id), $version);
            $this->guard->require($actor, 'recurring.manage', $schedule->company_id, tokens: true);
            $owner = $in->ownerId ?? $schedule->owner_id;
            $this->checkOwner($actor, $owner, $schedule->company_id, $this->documentTypeOf($kind, $schedule));
            $this->checkDates($in->nextDate, $in->endDate);

            $before = $schedule->attributesToArray();
            $schedule->forceFill([...$this->columns($in), 'name' => $in->name, 'owner_id' => $owner, 'last_error' => null, 'lock_version' => $schedule->lock_version + 1])->save();
            $schedule->refresh();
            $audit->add('recurring_schedule.updated', $schedule, before: $before, after: $schedule);

            return $schedule;
        });
    }

    /** Pause (inactive) or resume a schedule. Resuming a finished schedule needs a new end date through `update`. */
    public function setActive(Actor $actor, string $kind, string $id, int $version, bool $active): RecurringSchedule
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $kind, $id, $version, $active) {
            $schedule = $locks->document($this->find($kind, $id), $version);
            $this->guard->require($actor, 'recurring.manage', $schedule->company_id, tokens: true);
            if ($schedule->is_active === $active) {
                throw DomainRuleViolation::single($active ? 'recurring_already_active' : 'recurring_already_paused', $active ? 'The schedule is already running.' : 'The schedule is already paused.');
            }
            if ($active && $schedule->end_date !== null && $schedule->next_date > $schedule->end_date) {
                throw DomainRuleViolation::single('recurring_finished', 'The schedule has run to its end date; move the end date to resume it.');
            }

            $before = $schedule->attributesToArray();
            $schedule->forceFill(['is_active' => $active, 'lock_version' => $schedule->lock_version + 1])->save();
            $schedule->refresh();
            $audit->add($active ? 'recurring_schedule.resumed' : 'recurring_schedule.paused', $schedule, before: $before, after: $schedule);

            return $schedule;
        });
    }

    private function find(string $kind, string $id): RecurringSchedule
    {
        return ($kind === self::JOURNAL ? RecurringJournal::query() : RecurringInvoice::query())->findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function columns(RecurringScheduleInput $in): array
    {
        return [
            'frequency' => $in->frequency, 'anchor_day' => (int) $in->nextDate->format('j'), 'next_date' => $in->nextDate, 'end_date' => $in->endDate,
        ];
    }

    private function checkDates(DateTimeImmutable $next, ?DateTimeImmutable $end): void
    {
        if ($end !== null && $end < $next) {
            throw DomainRuleViolation::single('recurring_dates_invalid', 'The end date is before the next date, so the schedule would never run.');
        }
    }

    /** Only a posted, ordinary document makes a template: drafts would hold up the period close, notes mirror another document. */
    private function checkTemplate(string $kind, string $companyId, string $templateId): string
    {
        if ($kind === self::JOURNAL) {
            $journal = Journal::query()->with('lines')->where('company_id', $companyId)->find($templateId)
                ?? throw DomainRuleViolation::single('not_found', 'The template journal does not exist.');
            if ($journal->status !== JournalStatus::Posted || $journal->journal_type !== JournalType::Manual || $journal->source_type !== null) {
                throw DomainRuleViolation::single('recurring_template_invalid', 'A recurring journal copies a posted manual journal.');
            }
            $base = Company::query()->findOrFail($companyId)->base_currency;
            if ($journal->lines->contains(fn ($l) => $l->currency !== $base)) {
                throw DomainRuleViolation::single('recurring_template_foreign', 'A recurring journal must be in the company currency; a foreign-currency line would repeat a stale exchange rate.');
            }

            return 'journal';
        }

        $invoice = Invoice::query()->where('company_id', $companyId)->find($templateId)
            ?? throw DomainRuleViolation::single('not_found', 'The template document does not exist.');
        if ($invoice->status !== DocumentStatus::Posted || ! in_array($invoice->kind, [InvoiceKind::SalesInvoice, InvoiceKind::PurchaseBill], true)) {
            throw DomainRuleViolation::single('recurring_template_invalid', 'A recurring schedule copies a posted invoice or bill.');
        }

        return $invoice->kind->documentType();
    }

    private function documentTypeOf(string $kind, RecurringSchedule $schedule): string
    {
        if ($kind === self::JOURNAL) {
            return 'journal';
        }
        $invoice = Invoice::query()->findOrFail($schedule->templateId());

        return $invoice->kind->documentType();
    }

    /** The owner is the maker of every draft: an active member of the organisation who may create and submit that document type here. */
    private function checkOwner(Actor $actor, string $ownerId, string $companyId, string $documentType): void
    {
        $member = TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $ownerId)->where('status', 'active')->exists();
        $asOwner = new Actor(ActorType::User, $ownerId, $actor->tenantId, $companyId);
        if (! $member || ! $this->permissions->allows($asOwner, "{$documentType}s.create", $companyId) || ! $this->permissions->allows($asOwner, "{$documentType}s.submit", $companyId)) {
            throw DomainRuleViolation::single('recurring_owner_invalid', "The owner must be an active member who can create and submit {$documentType}s in this company.");
        }
    }
}
