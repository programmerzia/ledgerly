<?php

declare(strict_types=1);

namespace App\Actions\Workflow\Inputs;

final readonly class VoidDocumentInput
{
    public function __construct(public DocumentRef $document, public ?string $reason = null) {}
}
