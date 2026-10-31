<?php

declare(strict_types=1);

namespace App\Support\Problem;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Support\UnitOfWork\VersionConflict;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/** Renders errors as RFC 9457 application/problem+json (13 §16). */
final class ProblemRenderer
{
    public static function domain(DomainRuleViolation $e, Request $request): JsonResponse
    {
        $status = StatusMap::status($e->errorCode);
        $body = self::base($e->errorCode, $status, $e->getMessage(), $request);
        if ($e->violations !== []) {
            $body['violations'] = array_map(fn (Violation $v) => $v->toArray(), $e->violations);
        }
        if ($e instanceof VersionConflict) {
            $body['server_version'] = $e->serverVersion;
        }

        return self::respond($body, $status);
    }

    public static function validation(ValidationException $e, Request $request): JsonResponse
    {
        $body = self::base('validation_failed', 422, 'The request is invalid.', $request);
        $body['errors'] = $e->errors();

        return self::respond($body, 422);
    }

    /** @return array<string, mixed> */
    private static function base(string $code, int $status, string $detail, Request $request): array
    {
        return [
            'type' => 'https://docs.ledgerly.app/errors/'.$code,
            'title' => ucfirst(str_replace('_', ' ', $code)),
            'status' => $status,
            'code' => $code,
            'detail' => $detail,
            'request_id' => $request->headers->get('X-Request-Id'),
        ];
    }

    /** @param array<string, mixed> $body */
    private static function respond(array $body, int $status): JsonResponse
    {
        return new JsonResponse($body, $status, ['Content-Type' => 'application/problem+json']);
    }
}
