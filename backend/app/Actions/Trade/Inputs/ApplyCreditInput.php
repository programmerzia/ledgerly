<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use DateTimeImmutable;

/** Apply credit already on the books (D9) to an open document: name the settlement or the note that holds it. */
final readonly class ApplyCreditInput
{
    public function __construct(
        public string $invoiceId,
        public int $amountFc,
        public ?string $settlementId = null,
        public ?string $noteId = null,
        /** Null = the later of the two documents' dates. */
        public ?DateTimeImmutable $date = null,
    ) {}
}
