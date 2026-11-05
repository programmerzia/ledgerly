<?php

declare(strict_types=1);

namespace App\Http\Controllers\FixedAssets;

use App\Actions\FixedAssets\ManageAssetCategory;
use App\Http\Controllers\Controller;
use App\Http\Requests\FixedAssets\AssetCategoryRequest;
use App\Http\Resources\AssetCategoryResource;
use App\Http\Support\RequestActor;
use App\Models\FixedAssets\AssetCategory;
use App\Models\Organisation\Company;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Asset categories: accounts, default method and life, measurement model. */
final class AssetCategoryController extends Controller
{
    /** All the company's categories (there are few), by name. */
    #[Authorize('viewAny', AssetCategory::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        return AssetCategoryResource::collection(AssetCategory::query()->where('company_id', $company->id)->orderBy('name')->get());
    }

    #[Authorize('create', AssetCategory::class)]
    public function store(AssetCategoryRequest $request, Company $company, ManageAssetCategory $action): JsonResponse
    {
        $category = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new AssetCategoryResource($category))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'assetCategory')]
    public function update(AssetCategoryRequest $request, Company $company, AssetCategory $assetCategory, ManageAssetCategory $action): AssetCategoryResource
    {
        return new AssetCategoryResource($action->update(RequestActor::from($request, $company->id), $assetCategory->id, $request->toInput()));
    }
}
