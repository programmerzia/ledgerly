<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

/**
 * What one movement does to an asset: signed deltas on the additive figures, and absolute values for the few figures that
 * are not additive (`set`: status, disposed_on, depreciated_through, counterfactual_carrying). The values `set` replaces
 * are saved in the movement's meta, so a reversal can put them back.
 */
final readonly class MovementSpec
{
    /**
     * @param  array<string, mixed>  $set
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public string $date,
        public string $kind,
        public int $cost = 0,
        public int $depreciation = 0,
        public int $impairment = 0,
        public int $reserve = 0,
        public int $deficit = 0,
        public int $months = 0,
        public int $units = 0,
        public ?string $journalId = null,
        public ?string $documentType = null,
        public ?string $documentId = null,
        public array $set = [],
        public array $meta = [],
    ) {}
}
