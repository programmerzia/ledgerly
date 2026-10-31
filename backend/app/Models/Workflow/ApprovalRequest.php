<?php

declare(strict_types=1);

namespace App\Models\Workflow;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * One required signature of one document (a workflow step snapshot, per slot).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $document_type
 * @property string $document_id
 * @property string|null $workflow_id
 * @property int $step
 * @property int $slot
 * @property string $role
 * @property string $status
 * @property string|null $requested_by
 * @property CarbonImmutable $requested_at
 * @property string|null $decided_by
 * @property CarbonImmutable|null $decided_at
 * @property string|null $comment
 * @property string|null $signed_by
 * @property CarbonImmutable|null $signed_at
 * @property string|null $signature_hash
 */
class ApprovalRequest extends BaseModel
{
    /** requested_at / decided_at / signed_at are the meaningful times; no Laravel timestamps. */
    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['step' => 'integer', 'slot' => 'integer', 'requested_at' => 'immutable_datetime', 'decided_at' => 'immutable_datetime', 'signed_at' => 'immutable_datetime'];
    }
}
