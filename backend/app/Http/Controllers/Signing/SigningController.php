<?php

declare(strict_types=1);

namespace App\Http\Controllers\Signing;

use App\Actions\Signing\Inputs\SetSigningPinInput;
use App\Actions\Signing\Inputs\VerifySigningPinInput;
use App\Actions\Signing\SetSigningPin;
use App\Actions\Signing\VerifySigningPin;
use App\Http\Controllers\Controller;
use App\Http\Requests\Signing\SetSigningPinRequest;
use App\Http\Resources\SigningGrantResource;
use App\Http\Support\RequestActor;
use App\Support\Signing\SigningGrants;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Routing\Attributes\Controllers\Middleware;

/** The signing PIN (ADR-0004): set it, verify it for a 10-minute grant, drop the grant. */
#[Middleware('throttle:signing')]
final class SigningController extends Controller
{
    #[Authorize('sign')]
    public function setPin(SetSigningPinRequest $request, SetSigningPin $action): JsonResponse
    {
        $action->handle(RequestActor::user($request), new SetSigningPinInput((string) $request->validated('pin'), $request->session()->getId()));

        return new JsonResponse(['data' => ['signing_pin_set' => true]]);
    }

    #[Authorize('sign')]
    public function verify(Request $request, VerifySigningPin $action): SigningGrantResource
    {
        $pin = (string) $request->validate(['pin' => ['required', 'string', 'digits:6']])['pin'];
        $expiresAt = $action->handle(RequestActor::user($request), new VerifySigningPinInput($pin, $request->session()->getId()));

        return new SigningGrantResource(['granted' => true, 'expires_at' => $expiresAt->format(DATE_RFC3339)]);
    }

    #[Authorize('sign')]
    public function revoke(Request $request, SigningGrants $grants): JsonResponse
    {
        $grants->revoke(RequestActor::user($request)->id ?? '', $request->session()->getId());

        return new JsonResponse(['data' => ['granted' => false]]);
    }
}
