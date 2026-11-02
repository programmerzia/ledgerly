<?php

declare(strict_types=1);

namespace App\Http\Controllers\Workflow;

use App\Actions\Workflow\BulkApproveDocuments;
use App\Http\Controllers\Controller;
use App\Http\Requests\Workflow\BulkApproveRequest;
use App\Http\Resources\ApprovalRequestResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Workflow\ApprovalRequest;
use App\Queries\Workflow\ListApprovalInbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

final class ApprovalInboxController extends Controller
{
    /** Approvals the signed-in person could sign now, oldest first. */
    #[Authorize('viewAny', ApprovalRequest::class)]
    public function index(Request $request, Company $company, ListApprovalInbox $inbox): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($inbox(RequestActor::user($request, $company->id), $company->id), $request, 'id', kind: 'uuid');

        return ApprovalRequestResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /**
     * Approve several documents on one signing grant (doc 14 E5). The answer is always 200 with one result per document:
     * approved (with its status afterwards and number) or skipped with a code and reason. Sign first with `POST /signing/verify`.
     */
    #[Authorize('bulkApprove', ApprovalRequest::class)]
    public function bulkApprove(BulkApproveRequest $request, Company $company, BulkApproveDocuments $action): JsonResponse
    {
        $results = $action->handle(RequestActor::user($request, $company->id), $request->documents(), $request->comment());
        $approved = count(array_filter($results, fn ($r) => $r->ok));

        return response()->json([
            'data' => array_map(fn ($r): array => [
                'type' => $r->document->type, 'id' => $r->document->id, 'ok' => $r->ok,
                'status' => $r->status, 'number' => $r->number, 'code' => $r->code, 'reason' => $r->reason,
            ], $results),
            'meta' => ['approved' => $approved, 'skipped' => count($results) - $approved],
        ]);
    }
}
