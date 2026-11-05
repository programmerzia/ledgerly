<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Resources\FreeFormDataResource;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Queries\Menu\CompanyMenu;
use App\Queries\Organisation\HeldPermissions;
use App\Support\Tenancy\OrganisationRole;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The signed-in person's menu in one company, plus the permission names behind it so screens can skip calls their role cannot make. */
final class MenuController extends Controller
{
    /** `{sections, permissions, org_admin}`; people only, API clients have no menu. */
    #[Authorize('view', 'company')]
    public function show(Request $request, Company $company, CompanyMenu $menu, HeldPermissions $held, TenantContext $tenant): FreeFormDataResource
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw DomainRuleViolation::single('forbidden', 'The menu is for signed-in people.');
        }
        $permissions = $held($user->id, $company->id);

        return new FreeFormDataResource([
            'sections' => $menu($permissions),
            'permissions' => $permissions,
            'org_admin' => OrganisationRole::isAdmin(OrganisationRole::of($tenant->require(), $user->id)),
        ]);
    }
}
