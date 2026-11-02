<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Models\Procurement\BillMatchResult;

final readonly class BillMatchView
{
    /**
     * @param  list<array{code: string, message: string, line_no?: int}>  $refusals
     * @param  list<array{code: string, message: string, line_no?: int}>  $mismatches
     * @param  list<array{line_no: int, order_line_id: string, purchase_order_id: string, order_number: string|null, order_price_fc: int, ordered: string, received: string, billed_elsewhere: string}>  $lines
     */
    public function __construct(
        public bool $applies,
        public array $refusals,
        public array $mismatches,
        public array $lines,
        public string $currency,
        public ?BillMatchResult $last,
    ) {}
}
