<?php

declare(strict_types=1);

namespace App\Domain\Workflow;

/** One step of a workflow: `count` distinct holders of `role` must sign before the next step. */
final readonly class ApprovalStep
{
    public function __construct(public string $role, public int $count = 1)
    {
        if ($count < 1) {
            throw new \InvalidArgumentException('An approval step needs at least one approver.');
        }
    }
}
