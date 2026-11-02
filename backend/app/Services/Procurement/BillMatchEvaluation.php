<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Domain\Shared\Violation;

/** What the three-way match finds on one bill. */
final readonly class BillMatchEvaluation
{
    /**
     * @param  list<Violation>  $refusals  never overridable
     * @param  list<Violation>  $mismatches  a person with `bills.match_override` may override
     * @param  list<array{line_no: int, order_line_id: string, purchase_order_id: string, order_number: string|null, order_price_fc: int, ordered: string, received: string, billed_elsewhere: string}>  $lines
     */
    public function __construct(
        public bool $applies,
        public array $refusals = [],
        public array $mismatches = [],
        public array $lines = [],
    ) {}
}
