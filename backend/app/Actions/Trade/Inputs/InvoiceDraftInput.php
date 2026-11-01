<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use App\Domain\Trade\InvoiceKind;
use DateTimeImmutable;

/** A draft invoice, credit note, bill or debit note. Totals, tax and base amounts are calculated by the server. */
final readonly class InvoiceDraftInput
{
    /** @param list<InvoiceLineInput> $lines */
    public function __construct(
        public string $companyId,
        public InvoiceKind $kind,
        public string $contactId,
        public DateTimeImmutable $issueDate,
        public array $lines,
        public ?DateTimeImmutable $dueDate = null,
        /** Default: the contact's currency. */
        public ?string $currency = null,
        /** Positive decimal string; default: the stored rate on the issue date. Ignored for base-currency documents. */
        public ?string $fxRate = null,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $relatedInvoiceId = null,
        public ?string $whtCodeId = null,
        /** True when the client named the withholding code (null then means "none"); false lets the contact's code apply. */
        public bool $whtCodeGiven = false,
        /** Client-generated UUIDv7, accepted if unused (13 §12). */
        public ?string $id = null,
    ) {}
}
