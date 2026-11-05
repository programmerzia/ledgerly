<?php

declare(strict_types=1);

namespace App\Actions\Documents;

use App\Actions\Documents\Inputs\DunningInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Documents\MessageTemplate;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Trade\DunningStage;
use App\Services\Documents\DunningLedger;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\UnitOfWork\VersionConflict;

/**
 * Switches overdue-invoice reminders on or off and saves the stages (plan 3c.7; `settings.manage`, people only). Off by default.
 * A save replaces the whole list: stages that are named keep their id, new ones get one, and a stage left out is removed unless it
 * has already been used for an invoice (its record is the proof that the invoice was reminded, so it stays; change its wording
 * instead). Days after the due date are unique per company, 1 to 365. The wording may only use the allowlisted placeholders.
 */
final class ManageDunning
{
    public const int MAX_STAGES = 6;

    public function __construct(private readonly UnitOfWork $uow, private readonly IdGenerator $ids, private readonly SetupGuard $guard, private readonly DunningLedger $ledger) {}

    public function handle(Actor $actor, DunningInput $in): CompanySettings
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in): CompanySettings {
            if ($actor->isApiClient()) {
                throw DomainRuleViolation::single('forbidden', 'Reminder settings are changed by people.');
            }
            $this->guard->require($actor, 'settings.manage', $in->companyId);
            $this->assertValid($in);

            $company = Company::query()->whereKey($in->companyId)->lockForUpdate()->firstOrFail();
            $settings = CompanySettings::query()->where('company_id', $in->companyId)->lockForUpdate()->first()
                ?? (new CompanySettings)->forceFill(['tenant_id' => $actor->tenantId, 'company_id' => $in->companyId]);
            $server = (int) ($settings->getAttribute('lock_version') ?? 0);
            if ($in->version !== null && $in->version !== $server) {
                throw new VersionConflict($server, $in->version);
            }
            $before = $this->snapshot($settings, $in->companyId);

            $existing = DunningStage::query()->where('company_id', $in->companyId)->get()->keyBy('id');
            $keep = [];
            foreach ($in->stages as $stage) {
                if ($stage['id'] !== null) {
                    $row = $existing->get($stage['id']) ?? throw DomainRuleViolation::single('dunning_stage_unknown', 'One of the reminder stages no longer exists. Reload and try again.');
                    $row->forceFill(['days_after_due' => $stage['days_after_due'], 'subject' => $stage['subject'], 'body' => $stage['body']])->save();
                    $keep[] = $row->id;

                    continue;
                }
                $row = new DunningStage;
                $row->forceFill(['id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'days_after_due' => $stage['days_after_due'], 'subject' => $stage['subject'], 'body' => $stage['body']])->save();
                $keep[] = $row->id;
            }
            foreach ($existing as $id => $row) {
                if (in_array($id, $keep, true)) {
                    continue;
                }
                if ($this->ledger->stageUsed((string) $id)) {
                    throw DomainRuleViolation::single('dunning_stage_used', "The {$row->days_after_due}-day stage has already been used for invoices and cannot be removed. Change its wording instead.");
                }
                $row->delete();
            }

            $settings->forceFill(['dunning_enabled' => $in->enabled, 'lock_version' => $server + 1])->save();
            $settings->refresh();
            $audit->add('dunning.updated', $company, before: $before, after: $this->snapshot($settings, $in->companyId));

            return $settings;
        });
    }

    /** @return array<string, mixed> */
    private function snapshot(CompanySettings $settings, string $companyId): array
    {
        return [
            'enabled' => (bool) $settings->getAttribute('dunning_enabled'),
            'stages' => DunningStage::query()->where('company_id', $companyId)->orderBy('days_after_due')->get(['days_after_due', 'subject', 'body'])->toArray(),
        ];
    }

    private function assertValid(DunningInput $in): void
    {
        if (count($in->stages) > self::MAX_STAGES) {
            throw DomainRuleViolation::single('dunning_too_many_stages', 'Use at most '.self::MAX_STAGES.' reminder stages.');
        }
        $days = array_column($in->stages, 'days_after_due');
        if (count($days) !== count(array_unique($days))) {
            throw DomainRuleViolation::single('dunning_days_duplicate', 'Two stages cannot be sent on the same day after the due date.');
        }
        foreach ($in->stages as $stage) {
            if ($stage['days_after_due'] < 1 || $stage['days_after_due'] > 365) {
                throw DomainRuleViolation::single('dunning_days_invalid', 'Send a reminder 1 to 365 days after the due date.');
            }
            if (trim($stage['subject']) === '' || trim($stage['body']) === '') {
                throw DomainRuleViolation::single('dunning_wording_required', 'Every reminder needs a subject and a message.');
            }
            $bad = MessageTemplate::unknown($stage['subject']."\n".$stage['body']);
            if ($bad !== []) {
                throw DomainRuleViolation::single('dunning_placeholder_unknown', 'Unknown placeholder '.implode(', ', array_map(fn (string $b) => '{{ '.$b.' }}', $bad)).'.');
            }
        }
        if ($in->enabled && $in->stages === []) {
            throw DomainRuleViolation::single('dunning_stages_required', 'Add at least one reminder stage before switching reminders on.');
        }
    }
}
