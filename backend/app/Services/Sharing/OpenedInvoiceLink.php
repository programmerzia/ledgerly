<?php

declare(strict_types=1);

namespace App\Services\Sharing;

use App\Models\Organisation\Company;
use App\Models\Sharing\InvoiceShareLink;
use App\Models\Trade\Invoice;

/** A usable link with the one invoice it opens and its company, valid only inside the callback it was handed to. */
final readonly class OpenedInvoiceLink
{
    public function __construct(public InvoiceShareLink $link, public Invoice $invoice, public Company $company) {}
}
