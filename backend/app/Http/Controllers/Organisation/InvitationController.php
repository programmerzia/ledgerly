<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\InviteMember;
use App\Actions\Organisation\RevokeInvitation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\InviteMemberRequest;
use App\Http\Resources\InvitationResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Invitation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Open invitations of the current organisation (owners and admins). */
final class InvitationController extends Controller
{
    #[Authorize('viewAny', Invitation::class)]
    public function index(): AnonymousResourceCollection
    {
        return InvitationResource::collection(
            Invitation::query()->whereNull('accepted_at')->whereNull('revoked_at')->orderByDesc('created_at')->get(),
        );
    }

    #[Authorize('create', Invitation::class)]
    public function store(InviteMemberRequest $request, InviteMember $action): JsonResponse
    {
        $invitation = $action->handle(RequestActor::user($request), $request->toInput());

        return (new InvitationResource($invitation))->response()->setStatusCode(201);
    }

    #[Authorize('delete', 'invitation')]
    public function destroy(Request $request, Invitation $invitation, RevokeInvitation $action): Response
    {
        $action->handle(RequestActor::user($request), $invitation->id);

        return response()->noContent();
    }
}
