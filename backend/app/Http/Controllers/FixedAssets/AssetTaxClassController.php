<?php

declare(strict_types=1);

namespace App\Http\Controllers\FixedAssets;

use App\Actions\FixedAssets\ManageAssetTaxClass;
use App\Http\Controllers\Controller;
use App\Http\Requests\FixedAssets\AssetTaxClassRequest;
use App\Http\Resources\AssetTaxClassResource;
use App\Http\Resources\TaxScheduleResource;
use App\Http\Support\RequestActor;
use App\Models\FixedAssets\AssetTaxClass;
use App\Models\Organisation\Company;
use App\Queries\FixedAssets\TaxDepreciationSchedule;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Tax depreciation classes (data) and the tax depreciation schedule they drive: a report that never posts. */
final class AssetTaxClassController extends Controller
{
    #[Authorize('viewAny', AssetTaxClass::class)]
    public function index(Request $request, Company $company): AnonymousResourceCollection
    {
        return AssetTaxClassResource::collection(AssetTaxClass::query()->where('company_id', $company->id)->orderBy('code')->get());
    }

    #[Authorize('create', AssetTaxClass::class)]
    public function store(AssetTaxClassRequest $request, Company $company, ManageAssetTaxClass $action): JsonResponse
    {
        $v = $request->validated();
        $class = $action->create(
            RequestActor::from($request, $company->id), $company->id, trim((string) $v['code']), trim((string) $v['name']),
            (int) $v['annual_rate_bp'], isset($v['first_year_rate_bp']) ? (int) $v['first_year_rate_bp'] : null, (bool) ($v['is_active'] ?? true),
        );

        return (new AssetTaxClassResource($class))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'assetTaxClass')]
    public function update(AssetTaxClassRequest $request, Company $company, AssetTaxClass $assetTaxClass, ManageAssetTaxClass $action): AssetTaxClassResource
    {
        $v = $request->validated();

        return new AssetTaxClassResource($action->update(
            RequestActor::from($request, $company->id), $assetTaxClass->id, (int) $v['version'], trim((string) $v['name']),
            (int) $v['annual_rate_bp'], isset($v['first_year_rate_bp']) ? (int) $v['first_year_rate_bp'] : null, (bool) ($v['is_active'] ?? true),
        ));
    }

    /** Per asset with a tax class: the allowance and tax written-down value for each year. Optional `from_year` and `to_year`. */
    #[Authorize('viewAny', AssetTaxClass::class)]
    public function schedule(Request $request, Company $company, TaxDepreciationSchedule $schedule): TaxScheduleResource
    {
        $v = $request->validate(['from_year' => ['nullable', 'integer', 'min:1900', 'max:2200'], 'to_year' => ['nullable', 'integer', 'min:1900', 'max:2200']]);

        return new TaxScheduleResource($schedule($company->id, isset($v['from_year']) ? (int) $v['from_year'] : null, isset($v['to_year']) ? (int) $v['to_year'] : null));
    }
}
