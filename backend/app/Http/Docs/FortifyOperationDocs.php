<?php

declare(strict_types=1);

namespace App\Http\Docs;

use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\RequestBodyObject;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\BooleanType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\RouteInfo;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController;
use Laravel\Fortify\Http\Controllers\NewPasswordController;

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
            default => null,
        };
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
