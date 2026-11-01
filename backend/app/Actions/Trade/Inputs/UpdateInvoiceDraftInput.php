<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

final readonly class UpdateInvoiceDraftInput
{
    public function __construct(public string $invoiceId, public int $lockVersion, public InvoiceDraftInput $draft) {}
}
