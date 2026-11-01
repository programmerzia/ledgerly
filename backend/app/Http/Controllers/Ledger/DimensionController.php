<?php

declare(strict_types=1);

namespace App\Http\Controllers\Ledger;

use App\Actions\Ledger\ManageDimension;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\DimensionRequest;
use App\Http\Requests\Ledger\DimensionValueRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\DimensionResource;
use App\Http\Resources\DimensionValueResource;
use App\Http\Support\RequestActor;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Organisation\Company;
use App\Queries\Ledger\ListDimensions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Analysis dimensions and their values. Values are authorized through their dimension. */
final class DimensionController extends Controller
{
    #[Authorize('viewAny', Dimension::class)]
    public function index(Request $request, Company $company, ListDimensions $dimensions): AnonymousResourceCollection
    {
        return DimensionResource::collection($dimensions($company->id));
    }

    #[Authorize('create', Dimension::class)]
    public function store(DimensionRequest $request, Company $company, ManageDimension $action): JsonResponse
    {
        $dimension = $action->create(RequestActor::from($request, $company->id), $company->id, $request->code(), $request->name());

        return (new DimensionResource($dimension->load('values')))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'dimension')]
    public function update(DimensionRequest $request, Company $company, Dimension $dimension, ManageDimension $action): DimensionResource
    {
        $updated = $action->rename(RequestActor::from($request, $company->id), $dimension->id, $request->version(), $request->name());

        return new DimensionResource($updated->load('values'));
    }

    #[Authorize('deactivate', 'dimension')]
    public function deactivate(VersionRequest $request, Company $company, Dimension $dimension, ManageDimension $action): DimensionResource
    {
        $updated = $action->deactivate(RequestActor::from($request, $company->id), $dimension->id, $request->version());

        return new DimensionResource($updated->load('values'));
    }

    #[Authorize('update', 'dimension')]
    public function storeValue(DimensionValueRequest $request, Company $company, Dimension $dimension, ManageDimension $action): JsonResponse
    {
        $value = $action->createValue(RequestActor::from($request, $company->id), $dimension->id, $request->code(), $request->name(), $request->parentId());

        return (new DimensionValueResource($value))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'dimension')]
    public function updateValue(DimensionValueRequest $request, Company $company, Dimension $dimension, DimensionValue $dimensionValue, ManageDimension $action): DimensionValueResource
    {
        return new DimensionValueResource($action->renameValue(RequestActor::from($request, $company->id), $dimensionValue->id, $request->version(), $request->name()));
    }

    #[Authorize('update', 'dimension')]
    public function deactivateValue(VersionRequest $request, Company $company, Dimension $dimension, DimensionValue $dimensionValue, ManageDimension $action): DimensionValueResource
    {
        return new DimensionValueResource($action->deactivateValue(RequestActor::from($request, $company->id), $dimensionValue->id, $request->version()));
    }
}
