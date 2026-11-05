<?php

declare(strict_types=1);

namespace App\Actions\Documents;

use App\Actions\Documents\Inputs\SendDocumentInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Domain\Documents\StatementRunPeriod;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Documents\DocumentSend;
use App\Models\Trade\Contact;
use App\Queries\Trade\StatementRunCustomers;
use App\Support\Actor;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Sends the statements of the chosen customers in one step (plan 3c.7a). Every statement goes through the same path as one sent by
 * hand (`SendDocumentByEmail`: log, audit, PDF, `mail` queue), so the same rules apply to each, and each gets its own result.
 *
 * The hourly email limit (config documents.emails_per_hour, per company, counted from the send log so reminders and hand-sent
 * mail count too) is checked once, up front: a run that would go over it is refused whole, with the numbers, and nothing is sent.
 * It is not queued across hours and nothing is dropped silently. Reasons: a statement is a snapshot of a balance at the moment the
 * person chose, and mailing some customers an hour or more later, unseen, would send a balance that may no longer be right; and a
 * refusal needs no scheduler state to explain or cancel. One run per company at a time (a short cache lock), so two people cannot
 * both pass the check and exceed the limit together.
 */
final class RunStatements
{
    public function __construct(
        private readonly SendDocumentByEmail $send,
        private readonly StatementRunCustomers $customers,
        private readonly SetupGuard $guard,
        private readonly Clock $clock,
    ) {}

    /** @return array{used: int, limit: int, remaining: int} */
    public function allowance(string $companyId): array
    {
        $limit = (int) config('documents.emails_per_hour');
        $used = DocumentSend::query()->where('company_id', $companyId)->where('queued_at', '>', $this->clock->now()->modify('-1 hour'))->count();

        return ['used' => $used, 'limit' => $limit, 'remaining' => max(0, $limit - $used)];
    }

    /**
     * @param  list<string>  $contactIds
     * @return list<array{contact_id: string, name: string, status: string, code: string|null, reason: string|null, send_id: string|null}>
     */
    public function handle(Actor $actor, string $companyId, StatementRunPeriod $period, array $contactIds): array
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Statements are sent by people.');
        }
        $this->guard->require($actor, 'documents.send', $companyId);
        $this->guard->require($actor, 'reports.view', $companyId);
        $contactIds = array_values(array_unique($contactIds));
        if ($contactIds === []) {
            throw DomainRuleViolation::single('statement_run_empty', 'Choose at least one customer.');
        }

        $lock = Cache::lock("statement-run:{$companyId}", 120);
        if (! $lock->get()) {
            throw DomainRuleViolation::single('statement_run_in_progress', 'A statement run for this company is already going. Wait for it to finish.');
        }
        try {
            $allowance = $this->allowance($companyId);
            if (count($contactIds) > $allowance['remaining']) {
                throw DomainRuleViolation::single('statement_run_over_limit', sprintf(
                    'You chose %d customers, but only %d more emails can go out this hour (the limit is %d an hour for this company, and %d already went out). Nothing was sent. Choose %d or fewer now and run the rest later.',
                    count($contactIds), $allowance['remaining'], $allowance['limit'], $allowance['used'], $allowance['remaining'],
                ));
            }

            $balances = [];
            foreach (($this->customers)($companyId, $period->to) as $row) {
                $balances[$row['id']] = $row;
            }

            $results = [];
            foreach ($contactIds as $id) {
                $results[] = $this->one($actor, $companyId, $period, $id, $balances[$id] ?? null);
            }

            return $results;
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  array{id: string, code: string, name: string, email: string|null, balance: int, last_sent_at: string|null}|null  $row
     * @return array{contact_id: string, name: string, status: string, code: string|null, reason: string|null, send_id: string|null}
     */
    private function one(Actor $actor, string $companyId, StatementRunPeriod $period, string $id, ?array $row): array
    {
        $contact = Contact::query()->where('company_id', $companyId)->whereKey($id)->first();
        $name = $contact === null ? $id : $contact->name;
        $result = fn (string $status, ?string $code = null, ?string $reason = null, ?string $sendId = null): array => [
            'contact_id' => $id, 'name' => $name, 'status' => $status, 'code' => $code, 'reason' => $reason, 'send_id' => $sendId,
        ];
        if ($contact === null) {
            return $result('failed', 'not_found', 'This customer no longer exists.');
        }
        if ($contact->kind === 'supplier') {
            return $result('skipped', 'not_customer', 'This contact is a supplier, not a customer.');
        }
        if ($row === null) {
            return $result('skipped', 'no_balance', 'This customer has no balance at the end of the period.');
        }
        if ($row['email'] === null) {
            return $result('skipped', 'no_email', 'This customer has no email address. Add one to the customer and send again.');
        }
        try {
            $send = $this->send->handle($actor, $contact, new SendDocumentInput($companyId, [$row['email']], null, null, ['from' => $period->from, 'to' => $period->to, 'side' => 'customer']));
        } catch (DomainRuleViolation $e) {
            return $result('failed', $e->errorCode, $e->getMessage());
        } catch (Throwable $e) {
            report($e);

            return $result('failed', 'send_failed', 'The statement could not be queued. Try again.');
        }

        return $result('queued', null, null, $send->id);
    }
}
