<?php

declare(strict_types=1);

namespace App\Http\Controllers\Workflow;

use App\Actions\Workflow\ManageApprovalWorkflow;
use App\Http\Controllers\Controller;
use App\Http\Requests\VersionRequest;
use App\Http\Requests\Workflow\ApprovalWorkflowRequest;
use App\Http\Resources\ApprovalWorkflowResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Workflow\ApprovalWorkflow;
use App\Queries\Workflow\ListApprovalWorkflows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Approval workflows (`settings.manage`). Changes never touch documents already waiting for approval. */
final class ApprovalWorkflowController extends Controller
{
    #[Authorize('viewAny', ApprovalWorkflow::class)]
    public function index(Request $request, Company $company, ListApprovalWorkflows $workflows): AnonymousResourceCollection
    {
        return ApprovalWorkflowResource::collection($workflows($company->id));
    }

    #[Authorize('create', ApprovalWorkflow::class)]
    public function store(ApprovalWorkflowRequest $request, Company $company, ManageApprovalWorkflow $action): JsonResponse
    {
        $workflow = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new ApprovalWorkflowResource($workflow))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'workflow')]
    public function update(ApprovalWorkflowRequest $request, Company $company, ApprovalWorkflow $workflow, ManageApprovalWorkflow $action): ApprovalWorkflowResource
    {
        return new ApprovalWorkflowResource($action->update(RequestActor::from($request, $company->id), $workflow->id, $request->version(), $request->toInput()));
    }

    #[Authorize('deactivate', 'workflow')]
    public function deactivate(VersionRequest $request, Company $company, ApprovalWorkflow $workflow, ManageApprovalWorkflow $action): ApprovalWorkflowResource
    {
        return new ApprovalWorkflowResource($action->deactivate(RequestActor::from($request, $company->id), $workflow->id, $request->version()));
    }
}
