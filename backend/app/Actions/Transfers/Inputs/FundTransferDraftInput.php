<?php

declare(strict_types=1);

namespace App\Actions\Transfers\Inputs;

use DateTimeImmutable;

/** A draft fund transfer. Rates and the received amount are optional: a base-currency leg has rate 1, a foreign one takes the stored rate on the date. */
final readonly class FundTransferDraftInput
{
    public function __construct(
        public string $companyId,
        public string $fromBankAccountId,
        public string $toBankAccountId,
        public DateTimeImmutable $sendDate,
        public int $fromAmountFc,
        public ?int $toAmountFc = null,
        public ?string $sendRate = null,
        public ?string $receiveRate = null,
        public int $feeFc = 0,
        public ?string $feeAccountId = null,
        public bool $settleSameDay = false,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $id = null,
    ) {}
}
