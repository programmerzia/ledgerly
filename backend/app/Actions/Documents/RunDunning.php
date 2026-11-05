<?php

declare(strict_types=1);

namespace App\Actions\Documents;

use App\Actions\Documents\Inputs\SendDocumentInput;
use App\Contracts\Clock;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Trade\Invoice;
use App\Queries\Trade\DunningCandidates;
use App\Services\Documents\DunningLedger;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

/**
 * Sends the overdue-invoice reminders that are due today in the company's own timezone (plan 3c.7), as the system. Each reminder
 * is one transaction: the (invoice, stage) row in `dunning_sends` is claimed first, with the database's unique key, and then the
 * mail goes through the same send path as a person's (log, audit, PDF, `mail` queue, template). Losing the claim, or finding that
 * the invoice was paid or reversed in the meantime, sends nothing. A failure rolls the claim back with the rest, so the stage can
 * be tried again on a later run within its catch-up window. A contact with no email address is skipped and counted.
 */
final class RunDunning
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
        private readonly DunningLedger $ledger,
        private readonly SendDocumentByEmail $send,
        private readonly DunningCandidates $candidates,
    ) {}

    /** @return array{sent: int, no_email: int, failed: int} */
    public function handle(Actor $system, Company $company, ?DateTimeImmutable $on = null): array
    {
        $result = ['sent' => 0, 'no_email' => 0, 'failed' => 0];
        $settings = CompanySettings::query()->where('company_id', $company->id)->first();
        if ($settings === null || ! (bool) $settings->getAttribute('dunning_enabled')) {
            return $result;
        }
        $on ??= new DateTimeImmutable($this->clock->now()->setTimezone(new DateTimeZone($company->timezone))->format('Y-m-d'));

        foreach (($this->candidates)($company, $on) as $c) {
            if ($c['email'] === null) {
                $result['no_email']++;

                continue;
            }
            try {
                $sent = $this->uow->run($system, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($system, $company, $c, $on): bool {
                    $fresh = Invoice::query()->whereKey($c['invoice']->id)->lockForUpdate()->first();
                    if ($fresh === null || $fresh->status !== DocumentStatus::Posted || $fresh->amountDueFc() <= 0) {
                        return false;
                    }
                    $claimId = $this->ledger->claim($system->tenantId, $company->id, $fresh->id, $c['stage']->id, $on->format('Y-m-d'));
                    if ($claimId === null) {
                        return false;
                    }
                    $send = $this->send->automatic($system, $fresh, new SendDocumentInput(
                        $company->id, [$c['email']], $c['stage']->subject, $c['stage']->body, [], ['days_overdue' => (string) $c['days_overdue']],
                    ));
                    $this->ledger->attach($claimId, $send->id);
                    $audit->add('invoice.reminder_queued', $fresh, context: ['stage_days' => $c['stage']->days_after_due, 'days_overdue' => $c['days_overdue'], 'send_id' => $send->id]);

                    return true;
                });
                $sent ? $result['sent']++ : null;
            } catch (Throwable $e) {
                report($e);
                $result['failed']++;
            }
        }

        return $result;
    }
}
