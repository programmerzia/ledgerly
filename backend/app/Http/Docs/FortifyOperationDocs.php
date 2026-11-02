<?php

declare(strict_types=1);

namespace App\Http\Docs;

use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\RequestBodyObject;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\BooleanType;
use Dedoc\Scramble\Support\Generator\Types\IntegerType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\RouteInfo;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController;
use Laravel\Fortify\Http\Controllers\NewPasswordController;
use Laravel\Fortify\Http\Controllers\RegisteredUserController;
use ReflectionMethod;

/**
 * Scramble cannot read Fortify's vendor controllers (untyped `remember`, `token`, `password`, and
 * responses built through container-resolved response classes). This states what the two endpoints
 * the SPA calls really accept and return (13 §7), so the contract has no unknown types.
 */
final class FortifyOperationDocs extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        match ($routeInfo->route->getActionName()) {
            AuthenticatedSessionController::class.'@store' => $this->login($operation),
            NewPasswordController::class.'@store' => $this->resetPassword($operation),
            RegisteredUserController::class.'@store' => $this->register($operation),
            default => null,
        };
        $this->cursorParameters($operation, $routeInfo);
    }

    /** List actions read `cursor` and `limit` through CursorPage, out of Scramble's sight. */
    private function cursorParameters(Operation $operation, RouteInfo $routeInfo): void
    {
        $class = $routeInfo->route->getControllerClass();
        $method = $routeInfo->route->getActionMethod();
        if ($class === null || ! method_exists($class, $method)) {
            return;
        }
        $reflection = new ReflectionMethod($class, $method);
        $file = $reflection->getFileName();
        if ($file === false || $reflection->getDeclaringClass()->isInternal()) {
            return;
        }
        $lines = array_slice((array) file($file), $reflection->getStartLine() - 1, $reflection->getEndLine() - $reflection->getStartLine() + 1);
        if (! str_contains(implode('', $lines), 'CursorPage::fetch')) {
            return;
        }
        $operation->addParameters([
            Parameter::make('cursor', 'query')->setSchema(Schema::fromType(new StringType))->description('Opaque, from `meta.next_cursor` or `meta.prev_cursor`.'),
            Parameter::make('limit', 'query')->setSchema(Schema::fromType(new IntegerType))->description('Page size, 1 to 200; default 50.'),
        ]);
    }

    private function register(Operation $operation): void
    {
        $this->body($operation, (new ObjectType)
            ->addProperty('name', new StringType)
            ->addProperty('email', (new StringType)->format('email'))
            ->addProperty('password', new StringType)
            ->addProperty('password_confirmation', new StringType)
            ->addProperty('organisation_name', new StringType)
            ->setRequired(['name', 'email', 'password', 'password_confirmation', 'organisation_name']));
        $operation->summary('Create an account and its organisation, and sign in');
    }

    private function login(Operation $operation): void
    {
        $this->body($operation, (new ObjectType)
            ->addProperty('email', (new StringType)->format('email'))
            ->addProperty('password', new StringType)
            ->addProperty('remember', (new BooleanType)->setDescription('Keep the session beyond the browser being closed.'))
            ->setRequired(['email', 'password']));

        $operation->summary('Sign in with email and password');
        $this->success($operation, 'Signed in (`two_factor: false`), or the password was right and a TOTP code is still needed (`two_factor: true`; then call two-factor-challenge).', (new ObjectType)
            ->addProperty('two_factor', (new BooleanType)->setDescription('True when the second step is still pending; the session is not signed in yet.'))
            ->setRequired(['two_factor']));
    }

    private function resetPassword(Operation $operation): void
    {
        $this->body($operation, (new ObjectType)
            ->addProperty('token', new StringType)
            ->addProperty('email', (new StringType)->format('email'))
            ->addProperty('password', new StringType)
            ->addProperty('password_confirmation', new StringType)
            ->setRequired(['token', 'email', 'password', 'password_confirmation']));

        $operation->summary('Reset the password with the emailed token');
        $this->success($operation, 'Password changed.', (new ObjectType)
            ->addProperty('message', new StringType)
            ->setRequired(['message']));
    }

    private function body(Operation $operation, ObjectType $type): void
    {
        $operation->addRequestBodyObject(
            RequestBodyObject::make()->required()->setContent('application/json', Schema::fromType($type)),
        );
    }

    private function success(Operation $operation, string $description, ObjectType $type): void
    {
        $operation->responses = array_values(array_filter(
            $operation->responses ?? [],
            fn ($response): bool => ! ($response instanceof Response && $response->code === 200),
        ));
        array_unshift($operation->responses, Response::make(200)->setDescription($description)->setContent('application/json', Schema::fromType($type)));
    }
}
