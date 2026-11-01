<?php

declare(strict_types=1);

namespace App\Queries\Workflow;

use App\Models\Workflow\ApprovalWorkflow;
use Illuminate\Database\Eloquent\Collection;

final class ListApprovalWorkflows
{
    /** @return Collection<int, ApprovalWorkflow> */
    public function __invoke(string $companyId): Collection
    {
        return ApprovalWorkflow::query()->where('company_id', $companyId)->orderBy('document_type')->orderBy('min_amount')->orderBy('name')->get();
    }
}
