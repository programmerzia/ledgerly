<?php

declare(strict_types=1);

use App\Domain\Fiscal\CloseCheckStatus;
use App\Domain\Fiscal\ReopenRequestStatus;
use App\Models\Fiscal\PeriodCloseCheck;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/*
 * period_close_checks and period_reopen_requests (05 §4, 13 §10): tenant and company isolation, the
 * maker ≠ approver rules and the one-pending-request rule are enforced by the database itself.
 */

beforeEach(function (): void {
    $this->f = LedgerFixture::create();
    $this->march = $this->f->period('2026-03-15')->id;
    $this->users = closeTablesUsers(3); // requester, first approver, second approver
});

/** @return list<string> ids of new users (a global table: they belong to no tenant) */
function closeTablesUsers(int $count): array
{
    $ids = [];
    for ($i = 0; $i < $count; $i++) {
        $ids[] = $id = (string) Str::uuid7();
        DB::table('users')->insert(['id' => $id, 'name' => "Closer {$i}", 'email' => "{$id}@close.test", 'password' => 'x']);
    }

    return $ids;
}

/** A second company in the fixture's tenant (the tenant context is set). */
function closeTablesSecondCompany(LedgerFixture $f): string
{
    $id = (string) Str::uuid7();
    DB::table('companies')->insert(['id' => $id, 'tenant_id' => $f->tenantId, 'name' => 'Second', 'slug' => 'second', 'country' => 'US', 'base_currency' => 'USD']);

    return $id;
}

/**
 * @param  array<string, mixed>  $over
 * @return array<string, mixed>
 */
function closeCheckRow(LedgerFixture $f, string $periodId, array $over = []): array
{
    return [
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId,
        'fiscal_period_id' => $periodId, 'check_code' => 'no_draft_journals', 'status' => 'pass',
        'checked_at' => '2026-03-31 18:00:00+00',
        ...$over,
    ];
}

/**
 * @param  array<string, mixed>  $over
 * @return array<string, mixed>
 */
function reopenRequestRow(LedgerFixture $f, string $periodId, string $requestedBy, array $over = []): array
{
    return [
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId,
        'fiscal_period_id' => $periodId, 'requested_by' => $requestedBy, 'reason' => 'Late supplier invoice',
        ...$over,
    ];
}

/**
 * A valid row for either table, for tests that run against both.
 *
 * @param  array<string, mixed>  $over
 * @return array<string, mixed>
 */
function closeTablesRow(string $table, LedgerFixture $f, string $periodId, string $userId, array $over = []): array
{
    return $table === 'period_close_checks'
        ? closeCheckRow($f, $periodId, $over)
        : reopenRequestRow($f, $periodId, $userId, $over);
}

it('forces RLS with the tenant policy on both tables', function (): void {
    $tables = DB::select(<<<'SQL'
        SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
               EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS has_policy,
               EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id' AND col.is_nullable = 'NO') AS has_tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('period_close_checks', 'period_reopen_requests')
        ORDER BY c.relname
    SQL);

    expect(collect($tables)->pluck('name')->all())->toBe(['period_close_checks', 'period_reopen_requests'])
        ->and(collect($tables)->every(fn ($t) => $t->enabled && $t->forced && $t->has_policy && $t->has_tenant))->toBeTrue();
});

it('hides the other tenant\'s rows, refuses cross-tenant writes and fails closed without a context', function (): void {
    DB::table('period_close_checks')->insert(closeCheckRow($this->f, $this->march));
    DB::table('period_reopen_requests')->insert(reopenRequestRow($this->f, $this->march, $this->users[0]));

    LedgerFixture::create(slug: 'beta'); // leaves beta's context set
    $context = app(TenantContext::class);

    foreach (['period_close_checks', 'period_reopen_requests'] as $table) {
        expect(DB::table($table)->count())->toBe(0, $table)
            ->and($context->run($this->f->tenantId, fn () => DB::table($table)->count()))->toBe(1, $table);
    }

    // The composite FKs would accept alpha's period for an alpha row; the policy refuses it from beta.
    expect(fn () => DB::table('period_close_checks')->insert(closeCheckRow($this->f, $this->march, ['check_code' => 'other'])))
        ->toThrow(QueryException::class, 'row-level security')
        ->and(fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($this->f, $this->march, $this->users[1])))
        ->toThrow(QueryException::class, 'row-level security');

    $context->clear();
    expect(DB::table('period_close_checks')->count())->toBe(0)
        ->and(DB::table('period_reopen_requests')->count())->toBe(0)
        ->and(fn () => DB::table('period_close_checks')->insert(
            Arr::except(closeCheckRow($this->f, $this->march, ['check_code' => 'no_context']), ['tenant_id']),
        ))->toThrow(QueryException::class);
});

it('rejects a period of another company or tenant through the composite foreign key', function (string $table): void {
    $f = $this->f;
    $otherCompany = closeTablesSecondCompany($f);

    DB::table($table)->insert(closeTablesRow($table, $f, $f->period('2026-02-15')->id, $this->users[0])); // its own period: accepted

    // Same tenant, but the period belongs to the first company.
    expect(fn () => DB::table($table)->insert(closeTablesRow($table, $f, $this->march, $this->users[0], ['company_id' => $otherCompany])))
        ->toThrow(QueryException::class, 'foreign key constraint');

    // Another tenant's period id: FK checks bypass RLS, so only the (tenant_id, company_id, id) key stops it.
    $beta = LedgerFixture::create(slug: 'beta');
    DB::table($table)->insert(closeTablesRow($table, $beta, $beta->period('2026-03-15')->id, $this->users[0]));
    expect(fn () => DB::table($table)->insert(closeTablesRow($table, $beta, $this->march, $this->users[0])))
        ->toThrow(QueryException::class, 'foreign key constraint');
})->with(['period_close_checks', 'period_reopen_requests']);

it('rejects an approver who is the requester, and the same person approving twice', function (): void {
    [$requester, $first, $second] = $this->users;
    $f = $this->f;
    $insert = fn (array $over) => fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $requester, $over));

    expect($insert(['first_approver' => $requester]))->toThrow(QueryException::class, 'period_reopen_requests_first_approver_not_requester')
        ->and($insert(['second_approver' => $requester]))->toThrow(QueryException::class, 'period_reopen_requests_second_approver_not_requester')
        ->and($insert(['first_approver' => $first, 'second_approver' => $first]))->toThrow(QueryException::class, 'period_reopen_requests_approvers_distinct');

    // Every legitimate shape is accepted, which also shows the NULL handling of the checks.
    foreach ([
        '2026-03-15' => [], // new: no approver yet
        '2026-04-15' => ['first_approver' => $first, 'first_signed_at' => '2026-05-02 09:00:00+00'],
        '2026-05-15' => [
            'status' => 'approved', 'first_approver' => $first, 'first_signed_at' => '2026-06-02 09:00:00+00',
            'second_approver' => $second, 'second_signed_at' => '2026-06-03 09:00:00+00', 'decided_at' => '2026-06-03 09:00:00+00',
        ],
    ] as $date => $over) {
        DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $f->period($date)->id, $requester, $over));
    }

    expect(DB::table('period_reopen_requests')->count())->toBe(3);
});

it('applies the approver checks to updates, which is how approvals are recorded', function (): void {
    [$requester, $first, $second] = $this->users;
    $row = reopenRequestRow($this->f, $this->march, $requester);
    DB::table('period_reopen_requests')->insert($row);
    $update = fn (array $set) => fn () => DB::table('period_reopen_requests')->where('id', $row['id'])->update($set);

    expect($update(['first_approver' => $requester]))->toThrow(QueryException::class, 'period_reopen_requests_first_approver_not_requester')
        ->and($update(['second_approver' => $requester]))->toThrow(QueryException::class, 'period_reopen_requests_second_approver_not_requester')
        ->and($update(['first_approver' => $first, 'first_signed_at' => '2026-04-02 09:00:00+00'])())->toBe(1)
        ->and($update(['second_approver' => $first]))->toThrow(QueryException::class, 'period_reopen_requests_approvers_distinct')
        ->and($update(['second_approver' => $second, 'second_signed_at' => '2026-04-03 09:00:00+00'])())->toBe(1)
        ->and($update(['first_approver' => $second]))->toThrow(QueryException::class, 'period_reopen_requests_approvers_distinct');
});

it('allows one pending reopen request per period', function (): void {
    $f = $this->f;
    $requester = $this->users[0];
    $pending = fn (string $periodId) => reopenRequestRow($f, $periodId, $requester, ['status' => 'pending']);
    $first = $pending($this->march);
    DB::table('period_reopen_requests')->insert($first);

    expect(fn () => DB::table('period_reopen_requests')->insert($pending($this->march)))
        ->toThrow(QueryException::class, 'period_reopen_requests_one_pending');

    DB::table('period_reopen_requests')->insert($pending($f->period('2026-04-15')->id)); // another period is independent

    // Decided requests are history: any number may exist for the period, and a new pending one may follow.
    DB::table('period_reopen_requests')->where('id', $first['id'])->update(['status' => 'rejected', 'decided_at' => '2026-04-02 09:00:00+00']);
    DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $requester, ['status' => 'cancelled']));
    DB::table('period_reopen_requests')->insert($pending($this->march));

    expect(DB::table('period_reopen_requests')->where('fiscal_period_id', $this->march)->count())->toBe(3)
        ->and(DB::table('period_reopen_requests')->where('fiscal_period_id', $this->march)->where('status', 'pending')->count())->toBe(1)
        ->and(fn () => DB::table('period_reopen_requests')->where('id', $first['id'])->update(['status' => 'pending']))
        ->toThrow(QueryException::class, 'period_reopen_requests_one_pending');
});

it('keeps one close check per period and check code', function (): void {
    $f = $this->f;
    DB::table('period_close_checks')->insert(closeCheckRow($f, $this->march));

    expect(fn () => DB::table('period_close_checks')->insert(closeCheckRow($f, $this->march, ['status' => 'fail'])))
        ->toThrow(QueryException::class, 'period_close_checks_fiscal_period_id_check_code_unique');

    DB::table('period_close_checks')->insert(closeCheckRow($f, $this->march, ['check_code' => 'bank_reconciled']));
    DB::table('period_close_checks')->insert(closeCheckRow($f, $f->period('2026-04-15')->id));

    expect(DB::table('period_close_checks')->count())->toBe(3);
});

it('restricts statuses to their enums and requires real users for every user reference', function (): void {
    [$requester, $first] = $this->users;
    $f = $this->f;
    $stranger = (string) Str::uuid7();

    expect(fn () => DB::table('period_close_checks')->insert(closeCheckRow($f, $this->march, ['status' => 'maybe'])))
        ->toThrow(QueryException::class, 'period_close_checks_status_check')
        ->and(fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $requester, ['status' => 'approving'])))
        ->toThrow(QueryException::class, 'period_reopen_requests_status_check')
        ->and(fn () => DB::table('period_close_checks')->insert(closeCheckRow($f, $this->march, ['status' => 'waived', 'waived_by' => $stranger])))
        ->toThrow(QueryException::class, 'foreign key constraint')
        ->and(fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $stranger)))
        ->toThrow(QueryException::class, 'foreign key constraint')
        ->and(fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $requester, ['first_approver' => $stranger])))
        ->toThrow(QueryException::class, 'foreign key constraint')
        ->and(fn () => DB::table('period_reopen_requests')->insert(reopenRequestRow($f, $this->march, $requester, ['first_approver' => $first, 'second_approver' => $stranger])))
        ->toThrow(QueryException::class, 'foreign key constraint');
});

it('hydrates the models with enum and date casts and the period relation', function (): void {
    [$requester, $first, $second] = $this->users;
    $check = closeCheckRow($this->f, $this->march, [
        'status' => 'waived', 'waived_by' => $first, 'waived_reason' => 'Bank statement arrives Monday', 'detail' => json_encode(['unreconciled' => 3]),
    ]);
    $request = reopenRequestRow($this->f, $this->march, $requester, [
        'status' => 'approved', 'first_approver' => $first, 'first_signed_at' => '2026-04-02 09:00:00+00',
        'second_approver' => $second, 'second_signed_at' => '2026-04-03 09:00:00+00', 'decided_at' => '2026-04-03 09:00:00+00',
        'decision_comment' => 'Approved by both',
    ]);
    DB::table('period_close_checks')->insert($check);
    DB::table('period_reopen_requests')->insert($request);
    DB::table('fiscal_periods')->where('id', $this->march)->update([
        'status' => 'closed', 'soft_closed_at' => '2026-03-31 20:00:00+00', 'closed_at' => '2026-04-01 08:00:00+00', 'closed_by' => $first, 'reopened_count' => 1,
    ]);

    $loadedCheck = PeriodCloseCheck::query()->findOrFail($check['id']);
    $loadedRequest = PeriodReopenRequest::query()->findOrFail($request['id']);

    expect($loadedCheck->status)->toBe(CloseCheckStatus::Waived)
        ->and($loadedCheck->detail)->toBe(['unreconciled' => 3])
        ->and($loadedCheck->checked_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($loadedCheck->checked_at->getTimestamp())->toBe(CarbonImmutable::parse('2026-03-31 18:00:00+00')->getTimestamp())
        ->and($loadedCheck->fiscalPeriod->id)->toBe($this->march)
        ->and($loadedRequest->status)->toBe(ReopenRequestStatus::Approved)
        ->and($loadedRequest->first_signed_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($loadedRequest->decided_at?->getTimestamp())->toBe(CarbonImmutable::parse('2026-04-03 09:00:00+00')->getTimestamp())
        ->and($loadedRequest->fiscalPeriod->id)->toBe($this->march);

    $period = $loadedCheck->fiscalPeriod;
    expect($period->soft_closed_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($period->closed_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($period->closed_by)->toBe($first)
        ->and($period->reopened_count)->toBe(1);
});

it('defaults a new request to pending and a new period to never closed', function (): void {
    $request = reopenRequestRow($this->f, $this->march, $this->users[0]);
    DB::table('period_reopen_requests')->insert($request);

    $period = $this->f->period('2026-03-15');
    $loaded = PeriodReopenRequest::query()->findOrFail($request['id']);

    expect($loaded->status)->toBe(ReopenRequestStatus::Pending)
        ->and($loaded->first_approver)->toBeNull()
        ->and($loaded->second_approver)->toBeNull()
        ->and($loaded->decided_at)->toBeNull()
        ->and($period->soft_closed_at)->toBeNull()
        ->and($period->closed_at)->toBeNull()
        ->and($period->reopened_count)->toBe(0);
});
