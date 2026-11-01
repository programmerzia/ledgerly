<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/**
 * The resolved parameters of one report run. `from` is null for as-of reports (balances since the
 * beginning); `comparison` is the range or date to compare with, null when none was asked for or none exists.
 */
final readonly class ReportParams
{
    /**
     * @param  array<int, list<string>>  $dims  dimension slot → accepted value ids
     * @param  array<string, list<string>>  $dimensionIds  the same filter keyed by dimension id, as the client sent it
     * @param  array{from: string|null, to: string}|null  $comparisonRange
     */
    public function __construct(
        public string $companyId,
        public string $currency,
        public ?string $from,
        public string $to,
        public string $basis,
        public string $comparison,
        public ?array $comparisonRange,
        public array $dims,
        public array $dimensionIds,
        public bool $hideZero,
        public ?string $periodId = null,
        public ?string $accountId = null,
    ) {}

    /** @return array<string, mixed> everything that changes a result, for the cache key */
    public function cacheKey(): array
    {
        return [
            'from' => $this->from, 'to' => $this->to, 'basis' => $this->basis, 'comparison' => $this->comparison,
            'comparison_range' => $this->comparisonRange, 'dims' => $this->dimensionIds, 'hide_zero' => $this->hideZero,
            'account_id' => $this->accountId, 'currency' => $this->currency,
        ];
    }
}
