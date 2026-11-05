<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Contracts\Clock;
use App\Mail\NoticeMail;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Queries\Workflow\WaitingApprovals;
use App\Services\Notifications\ApprovalAudience;
use App\Services\Notifications\NotificationDraft;
use App\Services\Notifications\NotificationWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Approval SLA reminders (plan 3c.7), run by the system for one company. A workflow may say "remind after N hours". A document
 * that has waited on its current step for k whole intervals (k ≥ 1, counted from when the step opened: the submission, or the
 * previous step's last approval) is reminded about interval k once, never again for the same k: the row in `approval_reminders`
 * is unique per (document, step, k) and is claimed in the same transaction as the notifications, so overlapping runs cannot
 * double-send. A run that was missed for several intervals sends one reminder for the current k, not a burst. The people told
 * are the ones who could approve right now (the role holders, minus the makers and earlier signers), in the bell and by email.
 */
final class RemindApprovers
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
        private readonly WaitingApprovals $waiting,
        private readonly ApprovalAudience $audience,
        private readonly NotificationWriter $writer,
    ) {}

    /** @return int documents reminded */
    public function handle(Actor $actor, string $companyId): int
    {
        $company = Company::query()->findOrFail($companyId);
        $reminded = 0;
        foreach ($this->waiting->withReminders($companyId) as $row) {
            try {
                $reminded += $this->remind($actor, $company, $row['type'], $row['id'], $row['hours']) ? 1 : 0;
            } catch (Throwable $e) {
                report($e);
            }
        }

        return $reminded;
    }

    private function remind(Actor $actor, Company $company, string $type, string $id, int $hours): bool
    {
        $doc = $this->audience->find($type, $id);
        $step = $doc === null ? null : $this->audience->currentStep($type, $doc);
        if ($doc === null || $step === null) {
            return false;
        }
        $since = $this->waiting->stepOpenedAt($type, $id);
        $interval = intdiv($this->clock->now()->getTimestamp() - $since->getTimestamp(), $hours * 3600);
        if ($interval < 1) {
            return false;
        }

        $label = $this->audience->label($type, $doc);

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $company, $type, $id, $step, $interval, $label, $doc): bool {
            if (! $this->waiting->claim($actor->tenantId, $company->id, $type, $id, $step['step'], $interval, count($step['approvers']))) {
                return false;
            }
            $key = "reminder:{$type}:{$id}:{$step['step']}:{$interval}";
            $drafts = array_map(fn (string $user): NotificationDraft => new NotificationDraft(
                $user, $company->id, 'approval_reminder', "{$label} is still waiting for your approval",
                'It has been waiting for a '.$step['role'].' for a while. Please approve it or return it.', $type, $id, 'approvals', $key,
            ), $step['approvers']);
            $notified = $this->writer->store($actor->tenantId, $drafts);
            $audit->add('approval.reminded', $doc, context: ['step' => $step['step'], 'interval' => $interval, 'recipients' => count($step['approvers'])]);

            $url = rtrim((string) config('app.frontend_url'), '/').'/'.$company->slug.'/approvals';
            $this->uow->afterCommit(function () use ($notified, $label, $company, $url): void {
                foreach (User::query()->whereIn('id', $notified)->get() as $user) {
                    try {
                        Mail::to((string) $user->getAttribute('email'))->send(new NoticeMail("Reminder: {$label} is waiting for your approval", 'It is still waiting for you. Open it to approve or return it.', $url, $company->name));
                    } catch (Throwable $e) {
                        report($e);
                    }
                }
            });

            return true;
        });
    }
}
