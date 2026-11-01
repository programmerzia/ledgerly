<?php

declare(strict_types=1);

namespace App\Http\Controllers\Workflow;

use App\Http\Controllers\Controller;
use App\Http\Resources\ApprovalRequestResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Workflow\ApprovalRequest;
use App\Queries\Workflow\ListApprovalInbox;
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
}
