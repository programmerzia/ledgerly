<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\SettlementDocument;

/**
 * What posting a settlement does, worked out from rows read (and locked) by the caller.
 *
 * @phpstan-type Alloc array{id: string, invoice_id: string|null, source_id: string|null, amount_fc: int, amount: int, fx_gain_loss: int, label: string}
 */
final readonly class SettlementPlan
{
    /** @param list<array{id: string, invoice_id: string|null, source_id: string|null, amount_fc: int, amount: int, fx_gain_loss: int, label: string}> $allocations */
    public function __construct(
        public SettlementDocument $document,
        public array $allocations,
        public int $unallocatedFc,
        public int $unallocated,
        public ProposedJournal $proposed,
    ) {}
}
