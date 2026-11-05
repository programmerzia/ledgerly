<?php

declare(strict_types=1);

namespace App\Jobs\Documents;

use App\Contracts\Clock;
use App\Events\Notifications\NotificationEvent;
use App\Mail\DocumentMail;
use App\Models\Documents\DocumentSend;
use App\Models\Organisation\Company;
use App\Services\Documents\DocumentLook;
use App\Services\Documents\DocumentPdf;
use App\Services\Documents\EmailTargets;
use App\Services\Sharing\InvoiceLinkAccess;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Audit\DetachedAudit;
use App\Support\Outbox\OutboxPublisher;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Sends one queued document email (plan 3c.5). The tenant context is held for the whole job: the send row, the document and
 * the PDF are all read inside it. A row that is no longer `queued` is left alone, so a redelivered job cannot send twice.
 * Whatever happens, the row ends `sent` or `failed` and the outcome is audited. SMTP gives no later bounce callback, so a bounce
 * is not tracked: `sent` means the mail server accepted the message.
 */
final class SendDocumentEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public readonly string $tenantId, public readonly string $companyId, public readonly string $sendId)
    {
        $this->onQueue('mail');
    }

    public function handle(TenantContext $tenant, DocumentPdf $pdf, EmailTargets $targets, Clock $clock, DetachedAudit $audit, DocumentLook $looks): void
    {
        $tenant->run($this->tenantId, function () use ($pdf, $targets, $clock, $audit, $looks): void {
            $send = DocumentSend::query()->where('company_id', $this->companyId)->whereKey($this->sendId)->first();
            if ($send === null || $send->status !== 'queued') {
                return;
            }
            $actor = $send->queued_by === null ? Actor::system($this->tenantId, $this->companyId) : new Actor(ActorType::User, $send->queued_by, $this->tenantId, $this->companyId);
            $subject = $targets->subjectOf($send);

            try {
                $company = Company::query()->findOrFail($this->companyId);
                $type = $send->document_type === 'statement' ? (($send->parameters['side'] ?? 'customer').'_statement') : $send->document_type;
                $built = $pdf->render($type, $company, $send->document_id, $send->parameters);
                if (strlen($built['pdf']) > (int) config('documents.max_attachment_bytes')) {
                    throw new \RuntimeException('The PDF is too large to attach.');
                }
                $look = $looks->for($this->companyId);
                Mail::to($send->recipients)->send(new DocumentMail($company->name, $send->subject, $send->body, $send->attachment_name, $built['pdf'], $look['sender_name'], $look['reply_to']));
                $send->forceFill(['status' => 'sent', 'sent_at' => $clock->now(), ...InvoiceLinkAccess::scrubbed($send->subject, $send->body)])->save();
                $audit->record($actor, 'document.emailed', $subject, ['send_id' => $send->id, 'document_type' => $send->document_type, 'to' => $send->recipients]);
            } catch (Throwable $e) {
                $send->forceFill(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500), ...InvoiceLinkAccess::scrubbed($send->subject, $send->body)])->save();
                $audit->record($actor, 'document.email_failed', $subject, ['send_id' => $send->id, 'document_type' => $send->document_type, 'to' => $send->recipients]);
                if ($send->queued_by !== null) {
                    app(OutboxPublisher::class)->publish(new NotificationEvent(NotificationEvent::SEND_FAILED, [
                        'company_id' => $this->companyId, 'user_id' => $send->queued_by, 'send_id' => $send->id, 'label' => $send->subject,
                        'link_type' => $send->document_type, 'link_id' => $send->document_id,
                        'link' => match ($send->document_type) {
                            'invoice', 'credit_note' => 'invoices/'.$send->document_id,
                            'payment_advice' => 'payments/'.$send->document_id,
                            'receipt' => 'receipts/'.$send->document_id,
                            'statement' => 'customers/'.$send->document_id,
                            default => '',
                        },
                    ]));
                }
            }
        });
    }
}
