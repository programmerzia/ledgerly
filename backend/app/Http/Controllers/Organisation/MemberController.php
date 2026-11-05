<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompanyRole;
use App\Actions\Organisation\DeleteCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\ResetCompanyRole;
use App\Actions\Organisation\RevokeCompanyRole;
use App\Actions\Organisation\UpdateCompanyRole;
use App\Domain\Organisation\PermissionCatalogue;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\CompanyRoleRequest;
use App\Http\Resources\FreeFormDataResource;
use App\Http\Resources\MemberResource;
use App\Http\Resources\RoleResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Organisation\Role;
use App\Models\Platform\TenantUser;
use App\Queries\Organisation\ListMembers;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Facades\DB;

/** People and roles: who is in the organisation, which roles a company has, and who holds them. Organisation owners and admins. */
final class MemberController extends Controller
{
    /** Everyone in the organisation, each with their roles per company. */
    #[Authorize('viewAny', TenantUser::class)]
    public function index(ListMembers $members): AnonymousResourceCollection
    {
        return MemberResource::collection(collect($members()));
    }

    /** The company's roles with their permissions and head count. */
    #[Authorize('viewAny', TenantUser::class)]
    public function roles(Company $company): AnonymousResourceCollection
    {
        $roles = Role::query()->where('company_id', $company->id)->where('guard_name', 'web')->with('permissions')->orderBy('name')->get();
        $counts = DB::table('model_has_roles')->where('company_id', $company->id)->groupBy('role_id')->selectRaw('role_id, count(*) as members')->pluck('members', 'role_id');
        foreach ($roles as $role) {
            $role->setAttribute('members_count', (int) ($counts[$role->id] ?? 0));
        }

        return RoleResource::collection($roles);
    }

    /** Every permission of the matrix by module, with a plain-language label: the rows of the role grid. */
    #[Authorize('viewAny', TenantUser::class)]
    public function permissions(Company $company): FreeFormDataResource
    {
        return new FreeFormDataResource(PermissionCatalogue::modules());
    }

    /** Creates a custom role (copying a role is the same call with that role's permissions). */
    #[Authorize('manageRoles', 'company')]
    public function createRole(CompanyRoleRequest $request, Company $company, CreateCompanyRole $action): JsonResponse
    {
        $role = $action->handle(RequestActor::user($request, $company->id), $company->id, (string) $request->roleName(), $request->permissions());

        return (new RoleResource($this->withCount($role)))->response()->setStatusCode(201);
    }

    /** Changes a role's permissions (and a custom role's name). The Owner role is locked. */
    #[Authorize('manageRoles', 'company')]
    public function updateRole(CompanyRoleRequest $request, Company $company, string $role, UpdateCompanyRole $action): RoleResource
    {
        return new RoleResource($this->withCount($action->handle(RequestActor::user($request, $company->id), $company->id, $role, $request->roleName(), $request->permissions())));
    }

    /** Puts a standard role back to the default permissions. */
    #[Authorize('manageRoles', 'company')]
    public function resetRole(Request $request, Company $company, string $role, ResetCompanyRole $action): RoleResource
    {
        return new RoleResource($this->withCount($action->handle(RequestActor::user($request, $company->id), $company->id, $role)));
    }

    /** Deletes a custom role nobody holds. */
    #[Authorize('manageRoles', 'company')]
    public function deleteRole(Request $request, Company $company, string $role, DeleteCompanyRole $action): Response
    {
        $action->handle(RequestActor::user($request, $company->id), $company->id, $role);

        return response()->noContent();
    }

    /** Gives a member a role in this company (`role` is the role's id); repeating it changes nothing. */
    #[Authorize('manageRoles', 'company')]
    public function assign(Request $request, Company $company, string $user, string $role, AssignCompanyRole $action): MemberResource
    {
        $action->handle(RequestActor::user($request, $company->id), new CompanyRoleInput($user, $company->id, $this->roleName($company, $role)));

        return $this->member($user);
    }

    /** Takes a role away; taking away a role the member does not hold changes nothing. */
    #[Authorize('manageRoles', 'company')]
    public function revoke(Request $request, Company $company, string $user, string $role, RevokeCompanyRole $action): MemberResource
    {
        $action->handle(RequestActor::user($request, $company->id), new CompanyRoleInput($user, $company->id, $this->roleName($company, $role)));

        return $this->member($user);
    }

    private function withCount(Role $role): Role
    {
        $role->load('permissions');
        $role->setAttribute('members_count', DB::table('model_has_roles')->where('company_id', $role->company_id)->where('role_id', $role->id)->count());

        return $role;
    }

    private function roleName(Company $company, string $roleId): string
    {
        return Role::query()->where('company_id', $company->id)->where('guard_name', 'web')->findOrFail($roleId)->name;
    }

    private function member(string $userId): MemberResource
    {
        $member = collect(app(ListMembers::class)())->first(fn (TenantUser $m) => $m->user_id === $userId);

        return new MemberResource($member ?? throw new ModelNotFoundException);
    }
}
