<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Models\Organisation\Company;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\Route;
use Illuminate\Validation\ValidationException;

/**
 * Runs an API FormRequest over a row, so an import is held to exactly the rules the endpoint enforces (shape, formats, ids that exist in
 * the company, its `after()` checks) and `toInput()` builds the same Action input. The row is the request body; nothing here is a copy
 * of those rules. Throws ValidationException with the request's own messages.
 */
final class RequestRules
{
    /**
     * @template T of FormRequest
     *
     * @param  class-string<T>  $class
     * @param  array<string, mixed>  $payload
     * @return T
     *
     * @throws ValidationException
     */
    public function validate(string $class, Company $company, array $payload, string $routeName, string $method = 'POST'): FormRequest
    {
        $request = $class::create('/imports', $method, $payload);
        $request->setContainer(app())->setRedirector(app(Redirector::class));

        $route = new Route($method, '/imports', fn () => null);
        $route->name($routeName);
        $route->bind(Request::create('/imports', $method));
        $route->setParameter('company', $company);
        $request->setRouteResolver(fn () => $route);

        $request->validateResolved();

        return $request;
    }

    /**
     * Messages by field, each field renamed through $rename (request key → import field), unknown keys kept.
     *
     * @param  array<string, list<string>>  $errors
     * @param  array<string, string>  $rename
     * @return list<array{field: string|null, code: string, message: string}>
     */
    public static function errors(array $errors, array $rename = []): array
    {
        $out = [];
        foreach ($errors as $key => $messages) {
            foreach ($messages as $message) {
                $out[] = ['field' => $rename[$key] ?? $key, 'code' => 'invalid', 'message' => $message];
            }
        }

        return $out;
    }
}
