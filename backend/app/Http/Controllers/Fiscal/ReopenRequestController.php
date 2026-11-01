<?php

declare(strict_types=1);

namespace App\Http\Controllers\Fiscal;

use App\Actions\Fiscal\DecidePeriodReopen;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fiscal\ReasonRequest;
use App\Http\Resources\ReopenRequestResource;
use App\Http\Support\RequestActor;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\Organisation\Company;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Two distinct approvers, neither the requester, each with a signing grant (13 §10). */
final class ReopenRequestController extends Controller
{
    #[Authorize('approve', 'reopenRequest')]
    public function approve(Request $request, Company $company, PeriodReopenRequest $reopenRequest, DecidePeriodReopen $action): ReopenRequestResource
    {
        return new ReopenRequestResource($action->approve(RequestActor::from($request, $company->id), $reopenRequest->id));
    }

    #[Authorize('reject', 'reopenRequest')]
    public function reject(ReasonRequest $request, Company $company, PeriodReopenRequest $reopenRequest, DecidePeriodReopen $action): ReopenRequestResource
    {
        return new ReopenRequestResource($action->reject(RequestActor::from($request, $company->id), $reopenRequest->id, $request->text()));
    }
}
