<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

use DateTimeImmutable;

final readonly class ReverseAssetDocumentInput
{
    public function __construct(
        public string $documentId,
        /** Null = default per D3. */
        public ?DateTimeImmutable $date = null,
        public ?int $lockVersion = null,
        public ?string $memo = null,
    ) {}
}
