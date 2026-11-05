<?php

declare(strict_types=1);

namespace App\Models\Workflow;

use App\Domain\Workflow\ApprovalStep;
use App\Domain\Workflow\DocumentSource;
use App\Domain\Workflow\WorkflowDefinition;
use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $document_type
 * @property string $name
 * @property string $source
 * @property int $min_amount
 * @property int|null $max_amount
 * @property list<array{role: string, count?: int}> $steps
 * @property int|null $remind_after_hours
 * @property bool $is_active
 * @property int $lock_version
 */
class ApprovalWorkflow extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['steps' => 'array', 'is_active' => 'boolean', 'min_amount' => 'integer', 'max_amount' => 'integer', 'remind_after_hours' => 'integer', 'lock_version' => 'integer'];
    }

    public function toDefinition(): WorkflowDefinition
    {
        return new WorkflowDefinition(
            $this->id, $this->document_type,
            $this->source === 'any' ? null : DocumentSource::from($this->source),
            $this->min_amount, $this->max_amount,
            array_map(fn (array $s) => new ApprovalStep($s['role'], (int) ($s['count'] ?? 1)), $this->steps),
        );
    }
}
