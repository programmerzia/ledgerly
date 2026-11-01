<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Actions\Trade\UndoCreditApplication;
use App\Http\Controllers\Controller;
use App\Http\Resources\CreditApplicationResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Credit applied to documents (D9): undo only; applying is a verb on the credit's own resource. */
final class CreditApplicationController extends Controller
{
    #[Authorize('undo', 'creditApplication')]
    public function undo(Request $request, Company $company, CreditApplication $creditApplication, UndoCreditApplication $action): CreditApplicationResource
    {
        $action->handle(RequestActor::from($request, $company->id), $creditApplication->id);
        $fresh = CreditApplication::query()->findOrFail($creditApplication->id);
        $fresh->setAttribute('currency', Invoice::query()->whereKey($fresh->invoice_id)->value('currency'));

        return new CreditApplicationResource($fresh);
    }
}
