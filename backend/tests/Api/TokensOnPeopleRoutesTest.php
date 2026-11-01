<?php

declare(strict_types=1);

use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\File;
use Tests\Support\LedgerFixture;

/* 13 §7: a valid token on a route meant for people gets a clean 403, never a server error. */

beforeEach(function (): void {
    $this->f = LedgerFixture::create();
    $this->token = app(TenantContext::class)->run($this->f->tenantId, function (): string {
        $client = new ApiClient;
        $client->forceFill(['id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'name' => 'Sync', 'company_ids' => [$this->f->companyId], 'created_by' => $this->f->userId])->save();

        return $client->createToken('sync')->plainTextToken;
    });
    app(TenantContext::class)->clear();
    app('auth')->forgetGuards();
    $this->withHeaders(['Accept' => 'application/json', 'Idempotency-Key' => (string) Str::uuid7()])->withToken($this->token);
});

it('answers 403 on organisation and signing routes', function (string $method, string $path): void {
    $this->json($method, '/api/v1/'.$path, [])->assertForbidden()->assertJson(['code' => 'forbidden']);
})->with([
    ['GET', 'invitations'],
    ['POST', 'invitations'],
    ['POST', 'companies'],
    ['PUT', 'signing/pin'],
    ['POST', 'signing/verify'],
    ['DELETE', 'signing/grant'],
    ['GET', 'webhook-endpoints'],
]);

it('lets a token list the companies it was issued for', function (): void {
    $this->getJson('/api/v1/companies')->assertOk()->assertJsonPath('data.0.id', $this->f->companyId);
});

it('never type-hints User as a policy principal, which would turn a token into a 500', function (): void {
    foreach (File::allFiles(app_path('Policies')) as $file) {
        if ($file->getFilename() === 'PolicyContext.php') {
            continue; // the shared helper, not a policy
        }
        $class = 'App\\Policies\\'.str_replace(['/', '.php'], ['\\', ''], $file->getRelativePathname());
        foreach ((new ReflectionClass($class))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            $first = $method->getParameters()[0] ?? null;
            if ($method->getDeclaringClass()->getName() === $class && ! $method->isConstructor() && $first !== null) {
                expect((string) $first->getType())->not->toBe(User::class, "{$class}::{$method->getName()}");
            }
        }
    }
});
