<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Middleware\RequireIdempotencyKey;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Idempotency\IdempotencyScope;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;

/** Builds the Actor for a signed-in SPA user in the resolved tenant (13 §4). */
final class RequestActor
{
    public static function user(Request $request, ?string $companyId = null): Actor
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw DomainRuleViolation::single('unauthenticated', 'Sign in to continue.');
        }

        $idempotency = $request->attributes->get(RequireIdempotencyKey::ATTRIBUTE);

        return new Actor(
            ActorType::User, $user->id, app(TenantContext::class)->require(), $companyId,
            ip: $request->ip(), userAgent: $request->userAgent(),
            requestId: $request->header('X-Request-Id'),
            idempotencyKey: $idempotency instanceof IdempotencyScope ? $idempotency->key : null,
        );
    }
}
