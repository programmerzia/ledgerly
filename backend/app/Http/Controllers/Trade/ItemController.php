<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\ManageItem;
use App\Http\Controllers\Controller;
use App\Http\Requests\Trade\ItemRequest;
use App\Http\Requests\Trade\ListItemsRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\ItemResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\Item;
use App\Queries\Trade\ListItems;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Products and services of a company: the defaults for document lines. */
final class ItemController extends Controller
{
    #[Authorize('viewAny', Item::class)]
    public function index(ListItemsRequest $request, Company $company, ListItems $items): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($items($company->id, $request->kind(), $request->active(), $request->search()), $request, 'code');

        return ItemResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'item')]
    public function show(Company $company, Item $item): ItemResource
    {
        return new ItemResource($item);
    }

    #[Authorize('create', Item::class)]
    public function store(ItemRequest $request, Company $company, ManageItem $action): JsonResponse
    {
        $item = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new ItemResource($item))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'item')]
    public function update(ItemRequest $request, Company $company, Item $item, ManageItem $action): ItemResource
    {
        return new ItemResource($action->update(RequestActor::from($request, $company->id), $item->id, $request->version(), $request->toInput()));
    }

    #[Authorize('deactivate', 'item')]
    public function deactivate(VersionRequest $request, Company $company, Item $item, ManageItem $action): ItemResource
    {
        return new ItemResource($action->deactivate(RequestActor::from($request, $company->id), $item->id, $request->version()));
    }
}
