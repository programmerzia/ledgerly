<?php

declare(strict_types=1);

namespace App\Actions\Sharing;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Models\Sharing\InvoiceLinkView;
use App\Services\Sharing\OpenedInvoiceLink;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The view log of an online invoice link (plan 3c.7b): one row per opening of the page or request for the PDF, and the link's
 * running count and last-seen time. The viewer's address is kept only as a keyed hash, enough to tell repeat visits apart.
 * Runs as the system inside the link's tenant, which the public page already holds.
 */
final class RecordInvoiceLinkView
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock, private readonly IdGenerator $ids) {}

    /** @param 'page'|'pdf' $kind */
    public function handle(OpenedInvoiceLink $opened, string $kind, ?string $ip, ?string $userAgent): void
    {
        $actor = Actor::system($opened->link->tenant_id, $opened->link->company_id);
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($opened, $kind, $ip, $userAgent): void {
            $now = $this->clock->now();
            (new InvoiceLinkView)->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $opened->link->tenant_id, 'company_id' => $opened->link->company_id, 'link_id' => $opened->link->id,
                'kind' => $kind, 'viewer_hash' => hash_hmac('sha256', (string) $ip, (string) config('app.key')),
                'user_agent' => $userAgent === null ? null : mb_substr($userAgent, 0, 200), 'viewed_at' => $now,
            ])->save();
            $opened->link->newQuery()->whereKey($opened->link->id)->increment('view_count', 1, ['last_viewed_at' => $now]);
        });
    }
}
