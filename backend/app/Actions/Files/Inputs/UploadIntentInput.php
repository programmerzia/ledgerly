<?php

declare(strict_types=1);

namespace App\Actions\Files\Inputs;

final readonly class UploadIntentInput
{
    public function __construct(
        public string $companyId,
        public string $attachableType,
        public string $attachableId,
        public string $filename,
        public string $mime,
        public int $size,
        public string $sha256,
    ) {}
}
