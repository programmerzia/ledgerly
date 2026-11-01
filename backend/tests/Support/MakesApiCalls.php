<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Support\Signing\SigningGrants;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * HTTP-level fixtures for the company API: a tenant with company A (LedgerFixture, seeded roles), people
 * holding real seeded roles, API clients with token abilities, and a second company B in the same tenant
 * for the cross-company checks. Requests act as one principal at a time; switching resets the auth guards
 * (requests through auth:sanctum switch the default guard) and keeps one pinned session so signing
 * grants, which are bound to the session, hold across requests.
 */
trait MakesApiCalls
{
    public LedgerFixture $f;

    public string $sessionId;

    private int $personCount = 0;

    protected function setUpWorld(string $slug = 'acme'): void
    {
        $this->f = LedgerFixture::create('USD', $slug);
        app(SeedCompanyRoles::class)->handle($this->f->actor, $this->f->companyId);
        $this->sessionId = Str::random(40);
    }

    /** @param list<string> $roles company roles in company A (or $companyId) */
    protected function person(string $name, array $roles, ?string $companyId = null, string $org = 'member'): User
    {
        $id = (string) Str::uuid7();
        $slug = strtolower(str_replace(' ', '.', $name)).(++$this->personCount);
        DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => "{$slug}@test.example", 'password' => 'x']);
        $this->inTenant(function () use ($id, $org, $roles, $companyId): void {
            DB::table('tenant_users')->insert(['tenant_id' => $this->f->tenantId, 'user_id' => $id, 'role' => $org]);
            foreach ($roles as $role) {
                app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($id, $companyId ?? $this->f->companyId, $role));
            }
        });

        return User::query()->findOrFail($id);
    }

    /** Acts as a person in the pinned session; `$signing` presents a signing grant like a verified PIN. */
    protected function asPerson(User $user, bool $signing = false): static
    {
        app(TenantContext::class)->clear();
        app('auth')->forgetGuards();
        app('auth')->setDefaultDriver('web');
        unset($this->defaultHeaders['Authorization']);
        $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
        $this->withCredentials()->withCookie((string) config('session.cookie'), $this->sessionId);

        $grants = app(SigningGrants::class);
        $signing ? $grants->grant($user->id, $this->sessionId) : $grants->revoke($user->id, $this->sessionId);

        return $this->actingAs($user);
    }

    /** @param list<string> $abilities @param list<string>|null $companyIds default: company A */
    protected function newToken(array $abilities, ?array $companyIds = null): string
    {
        return app(TenantContext::class)->run($this->f->tenantId, function () use ($abilities, $companyIds): string {
            $client = new ApiClient;
            $client->forceFill([
                'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'name' => 'ERP sync',
                'company_ids' => $companyIds ?? [$this->f->companyId], 'created_by' => $this->f->userId,
            ])->save();

            return $client->createToken('sync', $abilities)->plainTextToken;
        });
    }

    protected function asToken(string $token): static
    {
        app(TenantContext::class)->clear();
        app('auth')->forgetGuards();
        app('auth')->setDefaultDriver('web');
        $this->withHeaders(['Referer' => '', 'Origin' => '', 'Accept' => 'application/json']);

        return $this->withToken($token);
    }

    /** A second company in the same tenant, with its own roles and owner; returns it. */
    protected function secondCompany(): Company
    {
        return app(TenantContext::class)->run($this->f->tenantId, function (): Company {
            $company = app(CreateCompany::class)->handle($this->f->actor, new CreateCompanyInput('Beta Co', 'US', 'USD', 1));
            app(SeedCompanyRoles::class)->handle($this->f->actor, $company->id);

            return $company;
        });
    }

    public function inTenant(Closure $work): mixed
    {
        return app(TenantContext::class)->run($this->f->tenantId, $work);
    }

    protected function api(string $path, ?string $companyId = null): string
    {
        return '/api/v1/companies/'.($companyId ?? $this->f->companyId).'/'.ltrim($path, '/');
    }

    /** @return array<string, string> a fresh Idempotency-Key header */
    protected function key(): array
    {
        return ['Idempotency-Key' => (string) Str::uuid7()];
    }

    /** @return array<string, mixed> a balanced two-line cash sale body */
    protected function journalBody(int $amount = 10000, string $date = '2026-03-15'): array
    {
        return [
            'journal_date' => $date, 'reference' => 'INV-1', 'memo' => 'Cash sale',
            'lines' => [
                ['account_id' => $this->f->account('1000'), 'debit' => $amount],
                ['account_id' => $this->f->account('4000'), 'credit' => $amount],
            ],
        ];
    }
}
