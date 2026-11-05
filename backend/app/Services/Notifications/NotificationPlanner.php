<?php

declare(strict_types=1);

namespace App\Services\Notifications;

use App\Events\Notifications\NotificationEvent;
use App\Support\Outbox\OutboxMessage;

/**
 * Turns an outbox message into the notifications it causes (plan 3c.6). Recipients: approval requested goes to the holders
 * of the current step's role (not the maker, not an earlier signer); approved (last signature) and returned go to the people
 * who made the document; an import's result to whoever started it; a finished export to whoever asked; a failed send to
 * whoever sent it. A message that names a document that is gone, or that nobody should hear about, plans nothing.
 * Every draft is keyed `outbox:{message id}`, so planning the same message twice stores nothing new.
 */
final class NotificationPlanner
{
    public const array TYPES = [
        'document.submitted', 'document.approved', 'document.returned', 'import.applied', 'import.failed',
        NotificationEvent::REPORT_READY, NotificationEvent::SEND_FAILED,
    ];

    public function __construct(private readonly ApprovalAudience $audience, private readonly ImportOwners $imports) {}

    /** @return list<NotificationDraft> */
    public function plan(OutboxMessage $m): array
    {
        $p = $m->payload;
        $company = (string) ($p['company_id'] ?? '');
        if ($company === '') {
            return [];
        }
        $key = 'outbox:'.$m->id;

        return match ($m->type) {
            'document.submitted', 'document.approved', 'document.returned' => $this->approvals($m, $company, $key),
            'import.applied', 'import.failed' => $this->import($m, $company, $key),
            NotificationEvent::REPORT_READY => $this->one((string) ($p['user_id'] ?? ''), $company, 'report_ready', 'Your report is ready', 'Your '.str_replace('-', ' ', (string) ($p['report'] ?? 'report')).' export can be downloaded now.', null, null, 'reports/'.(string) ($p['report'] ?? ''), $key),
            NotificationEvent::SEND_FAILED => $this->one((string) ($p['user_id'] ?? ''), $company, 'send_failed', 'An email did not go out', (string) ($p['label'] ?? 'A document').' could not be sent. Open it to see the reason and try again.', (string) ($p['link_type'] ?? ''), (string) ($p['link_id'] ?? ''), (string) ($p['link'] ?? ''), $key),
            default => [],
        };
    }

    /** @return list<NotificationDraft> */
    private function approvals(OutboxMessage $m, string $company, string $key): array
    {
        $p = $m->payload;
        $type = (string) ($p['document_type'] ?? '');
        $id = (string) ($p['document_id'] ?? '');
        $doc = $this->audience->find($type, $id);
        if ($doc === null) {
            return [];
        }
        $label = $this->audience->label($type, $doc);
        $link = $this->audience->link($type, $id);
        $out = [];

        $final = $m->type === 'document.approved' && (bool) ($p['final'] ?? false);
        if ($m->type === 'document.returned' || $final) {
            foreach ($this->audience->makers($doc) as $maker) {
                $out = [...$out, ...$this->one($maker, $company, $m->type === 'document.returned' ? 'document_returned' : 'document_approved',
                    $m->type === 'document.returned' ? "{$label} was returned" : "{$label} was approved",
                    $m->type === 'document.returned' ? 'It is back in draft. Open it to see what needs to change.' : 'The last approval is in and it is posted.',
                    $type, $id, $link, $key)];
            }

            return $out;
        }
        if ($m->type === 'document.submitted' && (bool) ($p['posted_directly'] ?? false)) {
            return [];
        }
        $step = $this->audience->currentStep($type, $doc);
        if ($step === null) {
            return [];
        }
        foreach ($step['approvers'] as $user) {
            $out = [...$out, ...$this->one($user, $company, 'approval_requested', "{$label} needs your approval", trim($this->audience->submittedBy($doc).' It is waiting for a '.$step['role'].'.'), $type, $id, 'approvals', $key)];
        }

        return $out;
    }

    /** @return list<NotificationDraft> */
    private function import(OutboxMessage $m, string $company, string $key): array
    {
        $p = $m->payload;
        $owner = $this->imports->starterOf((string) ($p['id'] ?? ''));
        if ($owner === null) {
            return [];
        }
        $failed = $m->type === 'import.failed';
        $rows = (int) ($p['rows_applied'] ?? 0);

        return $this->one($owner, $company, $failed ? 'import_failed' : 'import_finished',
            $failed ? 'Your import was refused' : 'Your import finished',
            $failed ? 'Nothing was applied. Open the import to see why.' : "{$rows} row".($rows === 1 ? '' : 's').' applied'.((int) ($p['rows_failed'] ?? 0) > 0 ? ', '.(int) $p['rows_failed'].' failed.' : '.'),
            'import', (string) ($p['id'] ?? ''), 'settings/import', $key);
    }

    /** @return list<NotificationDraft> */
    private function one(string $user, string $company, string $kind, string $title, ?string $body, ?string $type, ?string $id, ?string $link, string $key): array
    {
        if ($user === '') {
            return [];
        }

        return [new NotificationDraft($user, $company, $kind, $title, $body, $type === '' ? null : $type, $id === '' ? null : $id, $link === '' ? null : $link, $key)];
    }
}
