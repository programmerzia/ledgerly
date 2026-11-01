<?php

declare(strict_types=1);

namespace App\Http\Controllers\Fiscal;

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\RequestPeriodReopen;
use App\Actions\Fiscal\SoftClosePeriod;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fiscal\ClosePeriodRequest;
use App\Http\Requests\Fiscal\ReasonRequest;
use App\Http\Resources\CloseCheckResource;
use App\Http\Resources\FiscalPeriodResource;
use App\Http\Resources\ReopenRequestResource;
use App\Http\Support\RequestActor;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Queries\Fiscal\PreviewPeriodCloseChecks;
use App\Queries\Fiscal\ShowFiscalPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Period status changes: soft-close, close (with waivers), the checklist preview and reopen requests. People only. */
final class FiscalPeriodController extends Controller
{
    #[Authorize('softClose', 'fiscalPeriod')]
    public function softClose(Request $request, Company $company, FiscalPeriod $fiscalPeriod, SoftClosePeriod $action, ShowFiscalPeriod $show): FiscalPeriodResource
    {
        $action->handle(RequestActor::from($request, $company->id), $fiscalPeriod->id);

        return new FiscalPeriodResource($show($fiscalPeriod->id));
    }

    /** What the close checks say right now. Writes nothing; closing re-runs them under the period lock. */
    #[Authorize('checks', 'fiscalPeriod')]
    public function checks(Request $request, Company $company, FiscalPeriod $fiscalPeriod, PreviewPeriodCloseChecks $preview): AnonymousResourceCollection
    {
        return CloseCheckResource::collection(collect($preview($fiscalPeriod)));
    }

    /** Needs a signing grant. A failing check blocks the close unless its code is waived with a reason. */
    #[Authorize('close', 'fiscalPeriod')]
    public function close(ClosePeriodRequest $request, Company $company, FiscalPeriod $fiscalPeriod, ClosePeriod $action, ShowFiscalPeriod $show): FiscalPeriodResource
    {
        $action->handle(RequestActor::from($request, $company->id), new ClosePeriodInput($fiscalPeriod->id, $request->waivers()));

        return new FiscalPeriodResource($show($fiscalPeriod->id));
    }

    #[Authorize('requestReopen', 'fiscalPeriod')]
    public function requestReopen(ReasonRequest $request, Company $company, FiscalPeriod $fiscalPeriod, RequestPeriodReopen $action): JsonResponse
    {
        $reopen = $action->handle(RequestActor::from($request, $company->id), $fiscalPeriod->id, $request->text());

        return (new ReopenRequestResource($reopen))->response()->setStatusCode(201);
    }
}
