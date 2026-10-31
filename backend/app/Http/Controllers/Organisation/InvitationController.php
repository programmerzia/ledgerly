<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\InviteMember;
use App\Actions\Organisation\OrganisationAdmin;
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

/** Open invitations of the current organisation (owners and admins). */
final class InvitationController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        // Pending invitations show people's emails: owners and admins only (policies arrive in 1.6).
        OrganisationAdmin::require(RequestActor::user($request), 'Only organisation owners and admins can see invitations.');

        return InvitationResource::collection(
            Invitation::query()->whereNull('accepted_at')->whereNull('revoked_at')->orderByDesc('created_at')->get(),
        );
    }

    public function store(InviteMemberRequest $request, InviteMember $action): JsonResponse
    {
        $invitation = $action->handle(RequestActor::user($request), $request->toInput());

        return (new InvitationResource($invitation))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $invitation, RevokeInvitation $action): Response
    {
        $action->handle(RequestActor::user($request), $invitation);

        return response()->noContent();
    }
}
