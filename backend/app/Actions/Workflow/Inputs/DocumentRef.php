<?php

declare(strict_types=1);

namespace App\Actions\Workflow\Inputs;

final readonly class DocumentRef
{
    public function __construct(public string $type, public string $id, public ?int $lockVersion = null) {}
}
