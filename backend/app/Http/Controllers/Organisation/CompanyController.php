<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\CreateCompany;
use App\Contracts\CompanyAccess;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\CreateCompanyRequest;
use App\Http\Resources\CompanyResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class CompanyController extends Controller
{
    public function index(Request $request, CompanyAccess $access, TenantContext $tenant): AnonymousResourceCollection
    {
        $principal = $request->user();
        $tenantId = $tenant->require();

        $companies = Company::query()->orderBy('name')->get()
            ->filter(fn (Company $c): bool => $principal !== null && $access->allows($principal, $tenantId, $c->id))
            ->values();

        return CompanyResource::collection($companies);
    }

    public function store(CreateCompanyRequest $request, CreateCompany $action): JsonResponse
    {
        $company = $action->handle(RequestActor::user($request), $request->toInput());

        return (new CompanyResource($company))->response()->setStatusCode(201);
    }
}
