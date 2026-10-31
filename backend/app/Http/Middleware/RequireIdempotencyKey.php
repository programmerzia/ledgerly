<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Support\SubjectRepresenter;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Support\Idempotency\Claim;
use App\Support\Idempotency\ClaimOutcome;
use App\Support\Idempotency\IdempotencyScope;
use App\Support\Idempotency\IdempotencyStore;
use App\Support\Idempotency\RequestFingerprint;
use App\Support\Problem\ProblemRenderer;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * `Idempotency-Key` on mutating tenant routes (13 §11). Required for API clients; the SPA sends one
 * per user intent. The protocol lives in `IdempotencyStore`; this class maps it to HTTP:
 * replays carry `Idempotent-Replayed: true`, a live attempt answers 409 with `Retry-After: 1`.
 * Runs after `ResolveTenant`. The scope is handed to the Actor via a request attribute.
 */
final class RequireIdempotencyKey
{
    public const string HEADER = 'Idempotency-Key';

    public const string ATTRIBUTE = 'idempotency.scope';

    private const int MAX_STORED_BODY = 1_048_576;

    public function __construct(
        private readonly IdempotencyStore $store,
        private readonly TenantContext $tenant,
        private readonly SubjectRepresenter $representer,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethodSafe()) {
            return $next($request);
        }

        // Not $request->user(): its type is narrowed to User, but bearer tokens resolve an ApiClient.
        $principal = call_user_func($request->getUserResolver());
        $key = $request->headers->get(self::HEADER);
        if ($key === null || $key === '') {
            if ($principal instanceof ApiClient) {
                throw DomainRuleViolation::single('idempotency_key_required', 'Send an Idempotency-Key header with every change.');
            }

            return $next($request);
        }
        if (! preg_match('/^[\x21-\x7E]{1,255}$/', $key)) {
            throw DomainRuleViolation::single('idempotency_key_invalid', 'The Idempotency-Key must be 1 to 255 visible ASCII characters.');
        }

        [$actorType, $actorId] = match (true) {
            $principal instanceof ApiClient => ['api_client', $principal->id],
            $principal instanceof User => ['user', $principal->id],
            default => throw DomainRuleViolation::single('unauthenticated', 'Sign in to continue.'),
        };
        $scope = new IdempotencyScope($this->tenant->require(), $actorType, $actorId, $key);
        $claim = $this->store->claim($scope, RequestFingerprint::of($request));

        if ($claim->outcome === ClaimOutcome::Execute) {
            return $this->execute($request, $next, $scope, $claim);
        }

        $response = match ($claim->outcome) {
            ClaimOutcome::Reused => throw DomainRuleViolation::single('idempotency_key_reuse', 'This Idempotency-Key was already used for a different request.'),
            ClaimOutcome::InProgress => ProblemRenderer::http('idempotency_in_progress', 'An earlier attempt with this Idempotency-Key is still running.', $request)
                ->header('Retry-After', '1'),
            ClaimOutcome::Replay => response((string) $claim->responseBody, (int) $claim->responseStatus, [
                'Content-Type' => $claim->responseStatus === 422 ? 'application/problem+json' : 'application/json',
            ]),
            ClaimOutcome::ReplayCurrent => $this->representer->represent($claim->subjectType, $claim->subjectId),
        };
        if ($claim->outcome !== ClaimOutcome::InProgress) {
            $response->headers->set('Idempotent-Replayed', 'true');
        }

        return $response;
    }

    private function execute(Request $request, Closure $next, IdempotencyScope $scope, Claim $claim): Response
    {
        $request->attributes->set(self::ATTRIBUTE, $scope);

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->store->release($claim->id);

            throw $e;
        }

        $status = $response->getStatusCode();
        $body = (string) $response->getContent();
        try {
            if ((($status >= 200 && $status < 300) || $status === 422) && strlen($body) <= self::MAX_STORED_BODY) {
                $this->store->complete($claim->id, $status, $body);
            } else {
                // Only a still-pending key is deleted: a committed change stays protected.
                $this->store->release($claim->id);
            }
        } catch (Throwable $e) {
            // The request itself succeeded or failed already; bookkeeping must not change its answer.
            report($e);
        }

        return $response;
    }
}
