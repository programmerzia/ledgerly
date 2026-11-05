<?php

declare(strict_types=1);

namespace App\Actions\Sharing;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Sharing\InvoiceShareLink;
use App\Models\Trade\Invoice;
use App\Services\Sharing\InvoiceLinkAccess;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Making and revoking the online link of a posted invoice (plan 3c.7b; permission `documents.share`, people only). The raw token
 * and its address come back once, from `create`; afterwards only the link's status is ever shown. Both are audited.
 */
final class ManageInvoiceLinks
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly InvoiceLinkAccess $access,
        private readonly Clock $clock,
    ) {}

    /** @return array{link: InvoiceShareLink, url: string} */
    public function create(Actor $actor, Invoice $invoice, ?int $expiresInDays): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $invoice, $expiresInDays): array {
            $this->authorize($actor, $invoice->company_id);
            $locked = $locks->document($invoice);
            $made = $this->access->issue($actor->tenantId, $locked, 'manual', $actor->id, $expiresInDays);
            $audit->add('invoice.link_created', $locked, context: ['link_id' => $made['link']->id, 'expires_at' => $made['link']->expires_at?->toIso8601String()]);

            return ['link' => $made['link'], 'url' => $this->access->url($made['token'])];
        });
    }

    public function revoke(Actor $actor, Invoice $invoice, string $linkId): InvoiceShareLink
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $invoice, $linkId): InvoiceShareLink {
            $this->authorize($actor, $invoice->company_id);
            $locked = $locks->document($invoice);
            $link = InvoiceShareLink::query()->where('company_id', $invoice->company_id)->where('invoice_id', $locked->id)->whereKey($linkId)->lockForUpdate()->first()
                ?? throw DomainRuleViolation::single('not_found', 'That link does not exist.');
            if ($link->revoked_at !== null) {
                return $link;
            }
            $link->forceFill(['revoked_at' => $this->clock->now(), 'revoked_by' => $actor->id, 'updated_at' => $this->clock->now()])->save();
            $audit->add('invoice.link_revoked', $locked, context: ['link_id' => $link->id]);

            return $link->refresh();
        });
    }

    private function authorize(Actor $actor, string $companyId): void
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Online links are made by people.');
        }
        $this->guard->require($actor, 'documents.share', $companyId);
    }
}
