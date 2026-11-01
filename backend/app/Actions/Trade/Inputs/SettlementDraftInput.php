<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use DateTimeImmutable;

/**
 * A draft receipt, payment or refund. Allocations name a document (`invoiceId`) or, for a refund of credit on account,
 * the settlement that holds the credit (`sourceSettlementId`). Base amounts, carried amounts and FX are the server's.
 */
final readonly class SettlementDraftInput
{
    /**
     * @param  list<SettlementAllocationInput>  $allocations
     * @param  array<int, string>  $dims  position 1..8 → dimension value id
     */
    public function __construct(
        public string $companyId,
        public string $kind,
        public string $contactId,
        public string $cashAccountId,
        public DateTimeImmutable $settlementDate,
        public int $amountFc,
        public array $allocations = [],
        public ?string $currency = null,
        public ?string $fxRate = null,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $bankAccountId = null,
        public array $dims = [],
        public ?string $id = null,
        public ?string $paymentRunId = null,
    ) {}
}
