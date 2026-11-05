<?php

declare(strict_types=1);

namespace App\Http\Controllers\FixedAssets;

use App\Actions\FixedAssets\CreateFixedAsset;
use App\Actions\FixedAssets\UpdateFixedAsset;
use App\Http\Controllers\Controller;
use App\Http\Requests\FixedAssets\FixedAssetRequest;
use App\Http\Resources\FixedAssetResource;
use App\Http\Support\CursorPage;
use App\Http\Support\Json;
use App\Http\Support\RequestActor;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Organisation\Company;
use App\Queries\FixedAssets\AssetLedgerCheck;
use App\Queries\FixedAssets\ListCapitalisable;
use App\Queries\FixedAssets\ListFixedAssets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The asset register: list, capitalise or bring in an opening asset, change an estimate, and the register-to-ledger check. */
final class FixedAssetController extends Controller
{
    #[Authorize('viewAny', FixedAsset::class)]
    public function index(Request $request, Company $company, ListFixedAssets $assets): AnonymousResourceCollection
    {
        $query = $assets(
            $company->id,
            $request->query('category_id') ? (string) $request->query('category_id') : null,
            $request->query('status') ? (string) $request->query('status') : null,
            $request->query('q') ? (string) $request->query('q') : null,
        );
        $page = CursorPage::fetch($query, $request, 'number');

        return FixedAssetResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'fixedAsset')]
    public function show(Company $company, FixedAsset $fixedAsset): FixedAssetResource
    {
        return new FixedAssetResource($fixedAsset->load('category:id,name'));
    }

    #[Authorize('create', FixedAsset::class)]
    public function store(FixedAssetRequest $request, Company $company, CreateFixedAsset $action): JsonResponse
    {
        $asset = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new FixedAssetResource($asset->load('category:id,name')))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'fixedAsset')]
    public function update(FixedAssetRequest $request, Company $company, FixedAsset $fixedAsset, UpdateFixedAsset $action): FixedAssetResource
    {
        $asset = $action->handle(RequestActor::from($request, $company->id), $fixedAsset->id, $request->toUpdate());

        return new FixedAssetResource($asset->load('category:id,name'));
    }

    /** Posted bill and journal lines on fixed asset accounts that are not in the register yet. */
    #[Authorize('viewAny', FixedAsset::class)]
    public function capitalisable(Request $request, Company $company, ListCapitalisable $lines): JsonResponse
    {
        return response()->json(['data' => $lines($company->id, Json::baseCurrency($request))]);
    }

    /** Register cost and accumulated depreciation against the ledger's fixed asset and accumulated depreciation accounts, as of a date. */
    #[Authorize('viewAny', FixedAsset::class)]
    public function reconciliation(Request $request, Company $company, AssetLedgerCheck $check): JsonResponse
    {
        $input = $request->validate(['as_of' => ['nullable', 'date_format:Y-m-d']]);
        $asOf = (string) ($input['as_of'] ?? gmdate('Y-m-d'));

        return response()->json(['data' => $check($company->id, Json::baseCurrency($request), $asOf)]);
    }
}
