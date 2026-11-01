<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use DateTimeImmutable;

/**
 * A draft payment run: bills to pay and how much of each (net of the tax withheld when the bill posted). The run
 * pays in one currency; one payment per supplier is created when it posts.
 */
final readonly class PaymentRunDraftInput
{
    /** @param  list<array{invoice_id: string, amount_fc: int}>  $items */
    public function __construct(
        public string $companyId,
        public string $cashAccountId,
        public DateTimeImmutable $runDate,
        public array $items,
        public ?string $currency = null,
        public ?string $fxRate = null,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $bankAccountId = null,
        public ?string $id = null,
    ) {}
}
