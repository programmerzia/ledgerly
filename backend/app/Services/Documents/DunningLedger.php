<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use Illuminate\Support\Facades\DB;

/**
 * The record that a reminder stage was used for an invoice (`dunning_sends`). `claim` is the idempotency: the database's unique key
 * on (invoice, stage) lets exactly one caller win, so two overlapping runs cannot send the same reminder twice.
 */
final class DunningLedger
{
    public function __construct(private readonly Clock $clock, private readonly IdGenerator $ids) {}

    /** @return string|null the claim's id, or null when the stage was already used for this invoice */
    public function claim(string $tenantId, string $companyId, string $invoiceId, string $stageId, string $sentOn): ?string
    {
        $id = $this->ids->next();
        $won = DB::affectingStatement(
            'INSERT INTO dunning_sends (id, tenant_id, company_id, invoice_id, stage_id, sent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (invoice_id, stage_id) DO NOTHING',
            [$id, $tenantId, $companyId, $invoiceId, $stageId, $sentOn, $this->clock->now()->format('Y-m-d H:i:s.uP')],
        );

        return $won > 0 ? $id : null;
    }

    public function attach(string $claimId, string $documentSendId): void
    {
        DB::table('dunning_sends')->where('id', $claimId)->update(['document_send_id' => $documentSendId]);
    }

    public function stageUsed(string $stageId): bool
    {
        return DB::table('dunning_sends')->where('stage_id', $stageId)->exists();
    }
}
