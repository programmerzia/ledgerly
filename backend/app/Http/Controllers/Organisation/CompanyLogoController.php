<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\ManageCompanyLogo;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Resources\CompanySettingsResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Services\Documents\LogoStore;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The company logo (plan 3c.4): upload, show and remove. Never public: shown only to people who can read the settings. */
final class CompanyLogoController extends Controller
{
    /** The image itself. */
    #[Authorize('viewSettings', 'company')]
    public function show(Company $company, LogoStore $logos): Response
    {
        $logo = $logos->read($company) ?? throw DomainRuleViolation::single('not_found', 'This company has no logo.');

        return response($logo['bytes'], 200, ['Content-Type' => $logo['mime'], 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, max-age=300']);
    }

    /** Multipart upload, field `file`: PNG or JPEG, at most 512 KB. */
    #[Authorize('update', 'company')]
    public function store(Request $request, Company $company, ManageCompanyLogo $action): CompanySettingsResource
    {
        $request->validate(['file' => ['required', 'file', 'max:512']]);
        $upload = $request->file('file');
        $bytes = $upload === null ? false : file_get_contents($upload->getRealPath());
        $action->set(RequestActor::user($request, $company->id), $company->id, $bytes === false ? '' : $bytes);

        return new CompanySettingsResource($company->refresh());
    }

    #[Authorize('update', 'company')]
    public function destroy(Request $request, Company $company, ManageCompanyLogo $action): CompanySettingsResource
    {
        $action->remove(RequestActor::user($request, $company->id), $company->id);

        return new CompanySettingsResource($company->refresh());
    }
}
