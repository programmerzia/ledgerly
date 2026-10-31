<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Contracts\IdGenerator;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * 13 §5 step 1: accept a well-formed `X-Request-Id` or mint a UUIDv7, expose it to the log context,
 * problem+json bodies (they read the request header) and the response.
 */
final class AssignRequestId
{
    private const string HEADER = 'X-Request-Id';

    public function __construct(private readonly IdGenerator $ids) {}

    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->headers->get(self::HEADER);
        $id = is_string($incoming) && preg_match('/^[A-Za-z0-9._-]{8,128}$/', $incoming) === 1
            ? $incoming
            : $this->ids->next();

        $request->headers->set(self::HEADER, $id);
        Log::withContext(['request_id' => $id]);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set(self::HEADER, $id);

        return $response;
    }
}
