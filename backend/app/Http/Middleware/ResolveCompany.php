<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Contracts\CompanyAccess;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 13 §5 step 5, for routes under /companies/{company}: load the company (RLS limits the lookup to
 * the current tenant), check the principal may work in it, and set the company context and the
 * spatie permission team. A company of another tenant is indistinguishable from a missing one.
 */
final class ResolveCompany
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CompanyContext $company,
        private readonly CompanyAccess $access,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $routeValue = $request->route('company');
        $companyId = $routeValue instanceof Company ? $routeValue->id : $routeValue;

        $company = is_string($companyId) && preg_match('/^[0-9a-f-]{36}$/', $companyId) === 1
            ? Company::query()->where('status', 'active')->find($companyId)
            : null;
        if ($company === null) {
            throw DomainRuleViolation::single('company_not_found', 'This company does not exist or you cannot open it.');
        }

        $principal = call_user_func($request->getUserResolver());
        if (! $principal instanceof Authenticatable || ! $this->access->allows($principal, $this->tenant->require(), $company->id)) {
            throw DomainRuleViolation::single('company_access_denied', 'You do not have access to this company.');
        }

        $this->company->set($company->id);
        setPermissionsTeamId($company->id);
        $request->route()?->setParameter('company', $company);

        try {
            /** @var Response */
            return $next($request);
        } finally {
            $this->company->clear();
        }
    }
}
