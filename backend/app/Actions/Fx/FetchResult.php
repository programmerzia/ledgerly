<?php

declare(strict_types=1);

namespace App\Actions\Fx;

/** What a provider fetch did. `error` is set when the provider failed; existing rates are then untouched. */
final readonly class FetchResult
{
    /** @param list<string> $skipped currencies the feed does not quote */
    public function __construct(
        public int $inserted,
        public array $skipped,
        public ?string $rateDate,
        public string $provider,
        public ?string $error = null,
    ) {}
}
