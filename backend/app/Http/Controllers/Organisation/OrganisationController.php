<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\RenameOrganisation;
use App\Http\Controllers\Controller;
use App\Http\Resources\FreeFormDataResource;
use App\Http\Support\RequestActor;
use App\Models\Platform\Tenant;
use App\Queries\Organisation\OrganisationProfile;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The organisation page (plan 3c.26): profile and companies. Security policy, flags and export stay in Phase 4. */
final class OrganisationController extends Controller
{
    #[Authorize('view', Tenant::class)]
    public function show(Request $request, OrganisationProfile $profile): FreeFormDataResource
    {
        $principal = $request->user() ?? abort(401);

        return new FreeFormDataResource($profile($principal) + ['can' => ['update' => $principal->can('update', Tenant::class)]]);
    }

    #[Authorize('update', Tenant::class)]
    public function update(Request $request, RenameOrganisation $action, OrganisationProfile $profile): FreeFormDataResource
    {
        $name = $request->validate(['name' => ['required', 'string', 'max:'.RenameOrganisation::MAX_NAME]])['name'];
        $action->handle(RequestActor::user($request), $name);
        $principal = $request->user() ?? abort(401);

        return new FreeFormDataResource($profile($principal) + ['can' => ['update' => true]]);
    }
}
