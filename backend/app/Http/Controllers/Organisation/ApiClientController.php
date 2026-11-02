<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\ManageApiClient;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\ApiClientRequest;
use App\Http\Resources\ApiClientResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\ApiClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** API clients and their tokens (organisation owners and admins; people only). A token's secret is shown once, when it is created. */
final class ApiClientController extends Controller
{
    #[Authorize('viewAny', ApiClient::class)]
    public function index(): AnonymousResourceCollection
    {
        return ApiClientResource::collection(ApiClient::query()->with('tokens')->orderBy('created_at')->orderBy('id')->get());
    }

    /** Creates the client and its first token; the response carries `token`, which cannot be read again. */
    #[Authorize('create', ApiClient::class)]
    public function store(ApiClientRequest $request, ManageApiClient $action): JsonResponse
    {
        [$client, $token] = $action->create(RequestActor::user($request), $request->toInput());

        return (new ApiClientResource($client->load('tokens')))->revealing($token->plainTextToken)->response()->setStatusCode(201);
    }

    /** Another token for the client; the response carries `token`, which cannot be read again. */
    #[Authorize('revoke', 'apiClient')]
    public function issueToken(ApiClientRequest $request, ApiClient $apiClient, ManageApiClient $action): JsonResponse
    {
        $token = $action->issueToken(RequestActor::user($request), $apiClient->id, $request->toInput());

        return (new ApiClientResource($apiClient->refresh()->load('tokens')))->revealing($token->plainTextToken)->response()->setStatusCode(201);
    }

    /** Revokes the client: its tokens stop working at once. */
    #[Authorize('revoke', 'apiClient')]
    public function revoke(Request $request, ApiClient $apiClient, ManageApiClient $action): ApiClientResource
    {
        return new ApiClientResource($action->revoke(RequestActor::user($request), $apiClient->id)->load('tokens'));
    }
}
