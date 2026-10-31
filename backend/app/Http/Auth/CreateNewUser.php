<?php

declare(strict_types=1);

namespace App\Http\Auth;

use App\Actions\Organisation\Inputs\RegisterOrganisationInput;
use App\Actions\Organisation\RegisterOrganisation;
use App\Contracts\IdGenerator;
use App\Http\Middleware\AssignRequestId;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\CreatesNewUsers;

/** Fortify glue for `POST /api/v1/auth/register`: validate, then `RegisterOrganisation`. */
final class CreateNewUser implements CreatesNewUsers
{
    public function __construct(
        private readonly RegisterOrganisation $register,
        private readonly IdGenerator $ids,
        private readonly TenantContext $tenant,
        private readonly Request $request,
    ) {}

    /** @param array<string, mixed> $input */
    public function create(array $input): User
    {
        $data = Validator::make($input, [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'password' => PasswordRules::rules(),
            'organisation_name' => ['required', 'string', 'max:255'],
        ], ['email.unique' => 'An account with this email already exists. Sign in instead.'])->validate();

        $tenantId = $this->ids->next();
        $userId = $this->ids->next();
        $actor = new Actor(
            ActorType::User, $userId, $tenantId,
            ip: $this->request->ip(), userAgent: $this->request->userAgent(),
            requestId: $this->request->headers->get(AssignRequestId::HEADER),
        );

        return $this->tenant->run($tenantId, fn (): User => $this->register->handle($actor, new RegisterOrganisationInput(
            $tenantId, $userId, (string) $data['name'], (string) $data['email'], Hash::make((string) $data['password']),
            (string) $data['organisation_name'],
        )));
    }
}
