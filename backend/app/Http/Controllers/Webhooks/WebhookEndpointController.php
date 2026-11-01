<?php

declare(strict_types=1);

namespace App\Http\Controllers\Webhooks;

use App\Actions\Webhooks\ManageWebhookEndpoint;
use App\Actions\Webhooks\RedeliverWebhook;
use App\Http\Controllers\Controller;
use App\Http\Requests\Webhooks\ListWebhookDeliveriesRequest;
use App\Http\Requests\Webhooks\WebhookEndpointRequest;
use App\Http\Resources\WebhookDeliveryResource;
use App\Http\Resources\WebhookEndpointResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Webhook endpoints of the organisation and their delivery log (owners and admins; people only). */
final class WebhookEndpointController extends Controller
{
    #[Authorize('viewAny', WebhookEndpoint::class)]
    public function index(): AnonymousResourceCollection
    {
        return WebhookEndpointResource::collection(WebhookEndpoint::query()->orderBy('created_at')->orderBy('id')->get());
    }

    /** The response carries the signing secret; it is shown this once. */
    #[Authorize('create', WebhookEndpoint::class)]
    public function store(WebhookEndpointRequest $request, ManageWebhookEndpoint $action): JsonResponse
    {
        $endpoint = $action->create(RequestActor::user($request), $request->toInput());

        return (new WebhookEndpointResource($endpoint))->revealingSecret()->response()->setStatusCode(201);
    }

    #[Authorize('update', 'webhook')]
    public function update(WebhookEndpointRequest $request, WebhookEndpoint $webhook, ManageWebhookEndpoint $action): WebhookEndpointResource
    {
        return new WebhookEndpointResource($action->update(RequestActor::user($request), $webhook->id, $request->version(), $request->toInput()));
    }

    /** The new secret replaces the old at once and is shown this once. */
    #[Authorize('update', 'webhook')]
    public function rotateSecret(Request $request, WebhookEndpoint $webhook, ManageWebhookEndpoint $action): WebhookEndpointResource
    {
        return (new WebhookEndpointResource($action->rotateSecret(RequestActor::user($request), $webhook->id)))->revealingSecret();
    }

    #[Authorize('update', 'webhook')]
    public function disable(Request $request, WebhookEndpoint $webhook, ManageWebhookEndpoint $action): WebhookEndpointResource
    {
        return new WebhookEndpointResource($action->disable(RequestActor::user($request), $webhook->id));
    }

    #[Authorize('update', 'webhook')]
    public function enable(Request $request, WebhookEndpoint $webhook, ManageWebhookEndpoint $action): WebhookEndpointResource
    {
        return new WebhookEndpointResource($action->enable(RequestActor::user($request), $webhook->id));
    }

    /** Newest first; `?status=` narrows to pending, delivered, failed or cancelled. */
    #[Authorize('viewDeliveries', 'webhook')]
    public function deliveries(ListWebhookDeliveriesRequest $request, WebhookEndpoint $webhook): AnonymousResourceCollection
    {
        $query = WebhookDelivery::query()->where('endpoint_id', $webhook->id);
        if ($request->status() !== null) {
            $query->where('status', $request->status());
        }
        $page = CursorPage::fetch($query, $request, 'id', descending: true, kind: 'uuid');

        return WebhookDeliveryResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('redeliver', 'webhook')]
    public function redeliver(Request $request, WebhookEndpoint $webhook, WebhookDelivery $delivery, RedeliverWebhook $action): WebhookDeliveryResource
    {
        return new WebhookDeliveryResource($action->handle(RequestActor::user($request), $webhook->id, $delivery->id));
    }
}
