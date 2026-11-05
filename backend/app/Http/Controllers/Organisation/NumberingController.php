<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\SetNumberingRule;
use App\Domain\Organisation\NumberingKinds;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\NumberingRuleRequest;
use App\Http\Resources\FreeFormDataResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Queries\Organisation\NumberingOverview;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Document numbering per company and kind (`settings.view` / `settings.manage`; people only). A change starts with the next fiscal year. */
final class NumberingController extends Controller
{
    #[Authorize('viewSettings', 'company')]
    public function index(Company $company, NumberingOverview $overview): FreeFormDataResource
    {
        return new FreeFormDataResource($overview($company->id));
    }

    #[Authorize('update', 'company')]
    public function update(NumberingRuleRequest $request, Company $company, string $kind, SetNumberingRule $action, NumberingOverview $overview): FreeFormDataResource
    {
        abort_unless(isset(NumberingKinds::KINDS[$kind]), 404);
        $result = $action->handle(RequestActor::user($request, $company->id), $company->id, $kind, $request->prefix(), $request->padding(), $request->version());

        return (new FreeFormDataResource($overview($company->id)))->additional(['meta' => ['kind' => $kind, 'effective_from' => $result['from'], 'fiscal_year' => $result['fiscal_year'], 'unchanged' => $result['unchanged']]]);
    }
}
