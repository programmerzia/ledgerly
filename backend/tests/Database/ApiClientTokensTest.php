<?php

declare(strict_types=1);

use App\Models\Organisation\ApiClient;
use App\Models\Platform\PersonalAccessToken;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

it('forces RLS on invitations and api_clients', function () {
    $rows = DB::select("SELECT relname, relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE relname IN ('invitations', 'api_clients')");

    expect($rows)->toHaveCount(2);
    foreach ($rows as $row) {
        expect($row->e && $row->f)->toBeTrue();
    }
});

it('hides api clients and invitations of other tenants', function () {
    $a = LedgerFixture::create(slug: 'alpha');
    DB::table('api_clients')->insert([
        'id' => (string) Str::uuid7(), 'name' => 'a-client', 'created_by' => $a->userId,
        'company_ids' => '{'.$a->companyId.'}',
    ]);
    $b = LedgerFixture::create(slug: 'beta');
    $bClient = (string) Str::uuid7();
    DB::table('api_clients')->insert([
        'id' => $bClient, 'name' => 'b-client', 'created_by' => $b->userId, 'company_ids' => '{'.$b->companyId.'}',
    ]);
    DB::table('invitations')->insert([
        'id' => (string) Str::uuid7(), 'email' => 'x@beta.test', 'invited_by' => $b->userId,
        'token_hash' => hash('sha256', 'raw'), 'expires_at' => now()->addDay(),
    ]);

    $context = app(TenantContext::class);
    $context->set($a->tenantId);

    expect(DB::table('api_clients')->pluck('name')->all())->toBe(['a-client'])
        ->and(ApiClient::query()->find($bClient))->toBeNull()
        ->and(DB::table('invitations')->count())->toBe(0);

    expect(fn () => DB::table('api_clients')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $b->tenantId, 'name' => 'x', 'created_by' => $b->userId, 'company_ids' => '{}',
    ]))->toThrow(QueryException::class, 'row-level security');

    $context->set($b->tenantId);
    expect(ApiClient::query()->findOrFail($bClient)->company_ids)->toBe([$b->companyId]);
});

it('allows only one open invitation per email per tenant', function () {
    $f = LedgerFixture::create();
    $row = fn (string $email, string $hash) => [
        'id' => (string) Str::uuid7(), 'email' => $email, 'invited_by' => $f->userId,
        'token_hash' => hash('sha256', $hash), 'expires_at' => now()->addDay(),
    ];
    DB::table('invitations')->insert($row('Bob@x.test', 'one'));

    expect(fn () => DB::table('invitations')->insert($row('bob@X.test', 'two')))->toThrow(QueryException::class);

    DB::table('invitations')->update(['revoked_at' => now()]);
    DB::table('invitations')->insert($row('bob@x.test', 'three'));
    expect(DB::table('invitations')->count())->toBe(2);
});

it('stores tokens with tenant_id and reads them without tenant context', function () {
    $f = LedgerFixture::create();
    $clientId = (string) Str::uuid7();
    DB::table('api_clients')->insert([
        'id' => $clientId, 'name' => 'c', 'created_by' => $f->userId, 'company_ids' => '{'.$f->companyId.'}',
    ]);

    $token = ApiClient::query()->findOrFail($clientId)->createToken('ci', ['read']);
    app(TenantContext::class)->clear();

    // Readable without a tenant context, and stamped with the client's tenant (ApiClient::createToken).
    $stored = PersonalAccessToken::findToken($token->plainTextToken);
    expect($stored)->toBeInstanceOf(PersonalAccessToken::class)
        ->and($stored->tenant_id)->toBe($f->tenantId)
        ->and($stored->tokenable_id)->toBe($clientId)
        ->and(DB::table('personal_access_tokens')->where('tenant_id', $f->tenantId)->count())->toBe(1);
});
