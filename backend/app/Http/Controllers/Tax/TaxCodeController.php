<?php

declare(strict_types=1);

namespace App\Http\Controllers\Tax;

use App\Actions\Tax\ManageTaxCode;
use App\Http\Controllers\Controller;
use App\Http\Requests\Tax\ListTaxCodesRequest;
use App\Http\Requests\Tax\TaxCodeRequest;
use App\Http\Requests\Tax\TaxRateRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\TaxCodeResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Tax\TaxCode;
use App\Queries\Tax\ListTaxCodes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Tax codes and their dated rates. */
final class TaxCodeController extends Controller
{
    #[Authorize('viewAny', TaxCode::class)]
    public function index(ListTaxCodesRequest $request, Company $company, ListTaxCodes $codes): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($codes($company->id, $request->kind(), $request->active()), $request, 'code');

        return TaxCodeResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('create', TaxCode::class)]
    public function store(TaxCodeRequest $request, Company $company, ManageTaxCode $action): JsonResponse
    {
        $code = $action->create(RequestActor::from($request, $company->id), $request->toInput(), $request->firstRate());

        return (new TaxCodeResource($code->load('rates')))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'taxCode')]
    public function update(TaxCodeRequest $request, Company $company, TaxCode $taxCode, ManageTaxCode $action): TaxCodeResource
    {
        $code = $action->update(RequestActor::from($request, $company->id), $taxCode->id, $request->version(), $request->toInput($taxCode->code));

        return new TaxCodeResource($code->load('rates'));
    }

    #[Authorize('update', 'taxCode')]
    public function addRate(TaxRateRequest $request, Company $company, TaxCode $taxCode, ManageTaxCode $action): JsonResponse
    {
        $code = $action->addRate(RequestActor::from($request, $company->id), $taxCode->id, $request->version(), $request->toInput());

        return (new TaxCodeResource($code->load('rates')))->response()->setStatusCode(201);
    }

    #[Authorize('deactivate', 'taxCode')]
    public function deactivate(VersionRequest $request, Company $company, TaxCode $taxCode, ManageTaxCode $action): TaxCodeResource
    {
        $code = $action->deactivate(RequestActor::from($request, $company->id), $taxCode->id, $request->version());

        return new TaxCodeResource($code->load('rates'));
    }
}
