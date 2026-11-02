<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

final readonly class ReceiptLineInput
{
    public function __construct(public string $orderLineId, public string $quantity) {}
}
