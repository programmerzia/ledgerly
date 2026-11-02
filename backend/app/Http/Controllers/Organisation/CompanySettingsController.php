<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\UpdateCompanySettings;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organisation\UpdateCompanySettingsRequest;
use App\Http\Resources\CompanySettingsResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The company's profile, tax rounding and posting accounts (`settings.manage`; people only). */
final class CompanySettingsController extends Controller
{
    #[Authorize('viewSettings', 'company')]
    public function show(Company $company): CompanySettingsResource
    {
        return new CompanySettingsResource($company);
    }

    #[Authorize('update', 'company')]
    public function update(UpdateCompanySettingsRequest $request, Company $company, UpdateCompanySettings $action): CompanySettingsResource
    {
        $action->handle(RequestActor::user($request, $company->id), $request->toInput());
        $company->refresh();

        return new CompanySettingsResource($company);
    }
}
