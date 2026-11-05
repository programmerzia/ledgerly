<?php

declare(strict_types=1);

namespace App\Http\Controllers\Notifications;

use App\Actions\Notifications\ReadNotifications;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserNotificationResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Notifications\UserNotification;
use App\Models\Organisation\Company;
use App\Queries\Notifications\ListNotifications;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The bell (plan 3c.6): the signed-in person's own notifications in this company, newest first. */
final class NotificationController extends Controller
{
    /** `?unread=1` keeps unread ones only. `meta.unread_count` is always the person's full unread count. */
    #[Authorize('viewAny', UserNotification::class)]
    public function index(Request $request, Company $company, ListNotifications $list): AnonymousResourceCollection
    {
        $actor = RequestActor::user($request, $company->id);
        $page = CursorPage::fetch($list($actor, $company->id, $request->boolean('unread')), $request, 'id', descending: true, kind: 'uuid');

        return UserNotificationResource::collection($page->items)->additional(['meta' => [
            'next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit,
            'unread_count' => $list->unreadCount($actor, $company->id),
        ]]);
    }

    #[Authorize('viewAny', UserNotification::class)]
    public function read(Request $request, Company $company, string $notification, ReadNotifications $action): UserNotificationResource
    {
        return new UserNotificationResource($action->one(RequestActor::user($request, $company->id), $company->id, $notification));
    }

    #[Authorize('viewAny', UserNotification::class)]
    public function readAll(Request $request, Company $company, ReadNotifications $action): JsonResponse
    {
        return response()->json(['data' => ['marked' => $action->all(RequestActor::user($request, $company->id), $company->id)]]);
    }
}
