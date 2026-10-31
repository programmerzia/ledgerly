<?php

declare(strict_types=1);

namespace App\Actions\Workflow\Inputs;

final readonly class ReturnDocumentInput
{
    public function __construct(public DocumentRef $document, public string $comment) {}
}
