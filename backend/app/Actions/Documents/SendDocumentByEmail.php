<?php

declare(strict_types=1);

namespace App\Actions\Documents;

use App\Actions\Documents\Inputs\SendDocumentInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Documents\MessageTemplate;
use App\Domain\Shared\DomainRuleViolation;
use App\Jobs\Documents\SendDocumentEmail;
use App\Models\BaseModel;
use App\Models\Documents\DocumentSend;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Services\Documents\DocumentLook;
use App\Services\Documents\EmailTarget;
use App\Services\Documents\EmailTargets;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Sends a posted invoice, credit note, statement or payment advice by email (plan 3c.5; permission `documents.send`, people
 * only). Writes the send log row and an audit event in the transaction, and queues the mail after commit: the job renders
 * the PDF and sends inside the tenant context. The document is locked first, so a reversal that is racing the send is seen
 * before the row is written. The same message to the same people a few seconds apart is refused as a double click; the
 * Idempotency-Key header covers a retried request.
 */
final class SendDocumentByEmail
{
    private const int DOUBLE_CLICK_SECONDS = 30;

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly SetupGuard $guard,
        private readonly EmailTargets $targets,
        private readonly DocumentLook $look,
    ) {}

    public function handle(Actor $actor, BaseModel $document, SendDocumentInput $in): DocumentSend
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $document, $in) {
            if ($actor->isApiClient()) {
                throw DomainRuleViolation::single('forbidden', 'Documents are sent by people.');
            }
            $this->guard->require($actor, 'documents.send', $in->companyId);

            return $this->queue($actor, $document, $in, $locks, $audit);
        });
    }

    /**
     * The same send path for the scheduler (overdue-invoice reminders, plan 3c.7): the system, not a person, so there is no
     * permission to check; the caller decided what to send and to whom. The rules about the document and the log are the same.
     * Runs inside the caller's transaction when there is one, so the caller's own record commits with the send row.
     */
    public function automatic(Actor $system, BaseModel $document, SendDocumentInput $in): DocumentSend
    {
        return $this->uow->run($system, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($system, $document, $in) {
            if ($system->type !== ActorType::System) {
                throw DomainRuleViolation::single('forbidden', 'Only the scheduler sends without a person.');
            }

            return $this->queue($system, $document, $in, $locks, $audit);
        });
    }

    private function queue(Actor $actor, BaseModel $document, SendDocumentInput $in, LockSet $locks, AuditBuffer $audit): DocumentSend
    {
        $locked = $locks->document($document);
        $company = Company::query()->findOrFail($in->companyId);
        $target = $this->targets->resolve($locked, $company, $in->parameters, $this->senderName($actor, $company), $in->extraValues);

        $recipients = self::recipients($in->recipients);
        $template = $this->look->for($company->id)['email'][$target->family];
        $subject = trim(preg_replace('/\s+/', ' ', MessageTemplate::render($in->subject ?? $template['subject'], $target->values)) ?? '');
        $body = trim(str_replace("\r\n", "\n", MessageTemplate::render($in->body ?? $template['body'], $target->values)));
        if ($subject === '' || mb_strlen($subject) > 200) {
            throw DomainRuleViolation::single('subject_invalid', 'Give the email a subject of at most 200 characters.');
        }
        if ($body === '' || mb_strlen($body) > 5000) {
            throw DomainRuleViolation::single('body_invalid', 'Give the email a message of at most 5,000 characters.');
        }
        $this->refuseDoubleClick($company->id, $locked, $recipients);

        $send = new DocumentSend;
        $send->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id,
            'document_type' => $target->family, 'document_id' => (string) $locked->getKey(), 'contact_id' => $target->contact->id,
            'recipients' => $recipients, 'subject' => $subject, 'body' => $body,
            'attachment_name' => $this->attachmentName($target),
            'parameters' => $target->parameters, 'status' => 'queued', 'queued_by' => $actor->id, 'queued_at' => $this->clock->now(),
        ])->save();
        $send->refresh();
        $audit->add('document.email_queued', $locked, context: ['send_id' => $send->id, 'document_type' => $target->family, 'to' => $recipients]);
        $this->uow->afterCommit(fn () => SendDocumentEmail::dispatch($actor->tenantId, $company->id, $send->id));

        return $send;
    }

    /**
     * @param  list<string>  $given
     * @return list<string>
     */
    private static function recipients(array $given): array
    {
        $out = [];
        foreach ($given as $address) {
            $address = strtolower(trim($address));
            if ($address === '') {
                continue;
            }
            if (filter_var($address, FILTER_VALIDATE_EMAIL) === false || strlen($address) > 254) {
                throw DomainRuleViolation::single('recipient_invalid', "{$address} is not a valid email address.");
            }
            $out[$address] = $address;
        }
        if ($out === []) {
            throw DomainRuleViolation::single('recipient_required', 'Add at least one email address to send to.');
        }
        if (count($out) > (int) config('documents.max_recipients')) {
            throw DomainRuleViolation::single('too_many_recipients', 'Send to at most '.config('documents.max_recipients').' addresses at a time.');
        }

        return array_values($out);
    }

    /** @param list<string> $recipients */
    private function refuseDoubleClick(string $companyId, BaseModel $document, array $recipients): void
    {
        $since = $this->clock->now()->modify('-'.self::DOUBLE_CLICK_SECONDS.' seconds');
        $recent = DocumentSend::query()->where('company_id', $companyId)->where('document_id', (string) $document->getKey())
            ->where('queued_at', '>=', $since)->whereIn('status', ['queued', 'sent'])->get();
        foreach ($recent as $r) {
            if ($r->recipients === $recipients) {
                throw DomainRuleViolation::single('already_sent', 'This was just sent to the same people. Wait a moment if you meant to send it again.');
            }
        }
    }

    private function attachmentName(EmailTarget $target): string
    {
        $number = $target->values['document_number'] ?? ($target->parameters['to'] ?? 'statement');

        return preg_replace('/[^A-Za-z0-9._-]+/', '-', ($target->values['document_type'] ?? 'Document').'-'.$number).'.pdf';
    }

    private function senderName(Actor $actor, Company $company): string
    {
        if ($actor->type === ActorType::System) {
            $configured = $this->look->for($company->id)['sender_name'];

            return $configured !== '' ? $configured : $company->name;
        }
        $user = $actor->id === null ? null : User::query()->find($actor->id);

        return $user === null ? '' : (string) $user->getAttribute('name');
    }
}
