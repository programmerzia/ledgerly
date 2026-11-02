<?php

declare(strict_types=1);

namespace App\Http\Controllers\Audit;

use App\Http\Controllers\Controller;
use App\Http\Requests\Audit\ListAuditEventsRequest;
use App\Http\Resources\AuditChainReportResource;
use App\Http\Resources\AuditEventResource;
use App\Http\Support\CursorPage;
use App\Models\Audit\AuditEvent;
use App\Models\Organisation\Company;
use App\Queries\Audit\ListAuditEvents;
use App\Queries\Audit\VerifyAuditChain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

final class AuditController extends Controller
{
    /** The company's events, newest first. */
    #[Authorize('viewAny', AuditEvent::class)]
    public function index(ListAuditEventsRequest $request, Company $company, ListAuditEvents $events): AnonymousResourceCollection
    {
        $query = $events($company->id, $request->filter('action'), $request->filter('subject_type'), $request->filter('subject_id'), $request->filter('actor_id'), $request->filter('request_id'));
        $page = CursorPage::fetch($query, $request, 'id', descending: true, kind: 'int');

        return AuditEventResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /**
     * Recomputes the organisation's whole chain (the chain is per organisation, so this checks every company's events).
     * `full=true` starts from the first event; the default starts after the newest seal that still matches.
     */
    #[Authorize('verify', AuditEvent::class)]
    public function verify(Request $request, Company $company, VerifyAuditChain $verify): JsonResponse
    {
        $report = $verify($request->boolean('full') === false);

        return (new AuditChainReportResource($report))->response();
    }
}
