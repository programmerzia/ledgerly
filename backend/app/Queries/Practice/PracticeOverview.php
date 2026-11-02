<?php

declare(strict_types=1);

namespace App\Queries\Practice;

use App\Contracts\CompanyAccess;
use App\Http\Support\Json;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\DatabaseManager;

/**
 * The practice overview (13 §7, persona Nadia): the user's client organisations with the key figures of each
 * company they can open. This is the only cross-tenant read a user can make, and `tenant_kpi_snapshots` has no
 * RLS and no grant for the app role, so the scoping lives here and in the function it calls:
 *  1. `sysops.practice_overview(user)` returns only live tenants where THIS user's membership is active, with
 *     each tenant's snapshot rows. Nothing else reads the table.
 *  2. Within each tenant, a company is kept only if `CompanyAccess` allows it, checked in that tenant's context.
 * A tenant where the user holds no company access still appears (empty `companies`) because they are a member.
 */
final class PracticeOverview
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly CompanyAccess $access,
    ) {}

    /**
     * @return list<array{
     *     tenant: array{id: string, name: string, slug: string, lifecycle: string},
     *     role: string,
     *     current: bool,
     *     switch: array{method: string, path: string, body: array{tenant_id: string}},
     *     companies: list<array{
     *         id: string, name: string, base_currency: string,
     *         open_ar: array{amount: int, currency: string}, open_ap: array{amount: int, currency: string},
     *         pending_approvals: int, last_closed_period: string|null, period_states: array<string, int>, as_of: string|null
     *     }>
     * }>
     */
    public function __invoke(User $user, ?string $currentTenantId = null): array
    {
        $practices = [];
        foreach ($this->db->connection()->select('SELECT * FROM sysops.practice_overview(?)', [$user->id]) as $object) {
            $row = (array) $object;
            $tenantId = (string) $row['tenant_id'];
            $practices[$tenantId] ??= [
                'tenant' => ['id' => $tenantId, 'name' => (string) $row['tenant_name'], 'slug' => (string) $row['tenant_slug'], 'lifecycle' => (string) $row['tenant_lifecycle']],
                'role' => (string) $row['org_role'],
                'current' => $tenantId === $currentTenantId,
                'switch' => ['method' => 'PUT', 'path' => '/api/v1/session/tenant', 'body' => ['tenant_id' => $tenantId]],
                'companies' => [],
                '_rows' => [],
            ];
            if ($row['company_id'] !== null) {
                $practices[$tenantId]['_rows'][] = $row;
            }
        }

        $out = [];
        foreach ($practices as $tenantId => $practice) {
            $rows = $practice['_rows'];
            unset($practice['_rows']);
            $practice['companies'] = $rows === [] ? [] : $this->tenant->run($tenantId, fn (): array => $this->visible($user, $tenantId, $rows));
            $out[] = $practice;
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array{id: string, name: string, base_currency: string, open_ar: array{amount: int, currency: string}, open_ap: array{amount: int, currency: string}, pending_approvals: int, last_closed_period: string|null, period_states: array<string, int>, as_of: string|null}>
     */
    private function visible(User $user, string $tenantId, array $rows): array
    {
        $companies = [];
        foreach ($rows as $r) {
            if (! $this->access->allows($user, $tenantId, (string) $r['company_id'])) {
                continue;
            }
            $currency = (string) $r['base_currency'];
            /** @var array<string, int> $stored */
            $stored = (array) json_decode((string) $r['period_states'], true, 8, JSON_THROW_ON_ERROR);
            $states = [];
            foreach (['open', 'soft_closed', 'closed', 'locked'] as $state) {
                $states[$state] = (int) ($stored[$state] ?? 0); // jsonb does not keep key order
            }
            $companies[] = [
                'id' => (string) $r['company_id'],
                'name' => (string) $r['company_name'],
                'base_currency' => $currency,
                'open_ar' => Json::money((int) $r['open_ar'], $currency),
                'open_ap' => Json::money((int) $r['open_ap'], $currency),
                'pending_approvals' => (int) $r['pending_approvals'],
                'last_closed_period' => $r['last_closed_period'] === null ? null : (string) $r['last_closed_period'],
                'period_states' => $states,
                'as_of' => $r['refreshed_at'] === null ? null : (new DateTimeImmutable((string) $r['refreshed_at']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z'),
            ];
        }

        return $companies;
    }
}
