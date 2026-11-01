<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PaymentStatus;

/** The filters of the document lists. All optional; dates are YYYY-MM-DD. */
final readonly class InvoiceFilter
{
    /** @param list<InvoiceKind> $kinds the family of the route (sales or purchases), narrowed by `kind` */
    public function __construct(
        public array $kinds,
        public ?string $status = null,
        public ?string $contactId = null,
        public ?string $issuedFrom = null,
        public ?string $issuedTo = null,
        public ?string $dueFrom = null,
        public ?string $dueTo = null,
        public ?PaymentStatus $paymentStatus = null,
        public ?bool $overdue = null,
        public ?string $search = null,
    ) {}
}
