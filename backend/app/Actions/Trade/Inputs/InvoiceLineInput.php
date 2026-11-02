<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

/** One line as the client states it. Anything left out comes from the item's defaults; amounts are never taken from the client. */
final readonly class InvoiceLineInput
{
    public function __construct(
        public string $quantity,
        public ?string $itemId = null,
        public ?string $accountId = null,
        public ?string $description = null,
        public ?int $unitPriceFc = null,
        public string $discountPct = '0',
        public ?string $taxCodeId = null,
        /** True when the client named the tax code (null then means "no tax"); false lets the item's default apply. */
        public bool $taxCodeGiven = false,
        /** @var array<int, string> dimension slot → value id */
        public array $dims = [],
        /** The purchase order line this bill line bills; only on a purchase bill. */
        public ?string $purchaseOrderLineId = null,
        public ?string $goodsReceiptLineId = null,
    ) {}
}
