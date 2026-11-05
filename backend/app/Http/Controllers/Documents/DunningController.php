<?php

declare(strict_types=1);

namespace App\Http\Controllers\Documents;

use App\Actions\Documents\ManageDunning;
use App\Contracts\Clock;
use App\Http\Controllers\Controller;
use App\Http\Requests\Documents\DunningRequest;
use App\Http\Resources\DunningPreviewResource;
use App\Http\Resources\DunningSettingsResource;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Queries\Trade\DunningCandidates;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Overdue-invoice reminders (plan 3c.7): the settings and the stages, and a preview of what a run would send.
 * Reading needs the right to see company settings, changing it `settings.manage`.
 */
final class DunningController extends Controller
{
    #[Authorize('viewSettings', 'company')]
    public function show(Company $company): DunningSettingsResource
    {
        return new DunningSettingsResource($company);
    }

    #[Authorize('update', 'company')]
    public function update(DunningRequest $request, Company $company, ManageDunning $action): DunningSettingsResource
    {
        $action->handle(RequestActor::user($request, $company->id), $request->toInput());

        return new DunningSettingsResource($company);
    }

    /**
     * What a run on `?date=` (default: tomorrow, by the company's own calendar) would send, one row per invoice. A contact with no
     * email address is listed and flagged (`will_send` false). With reminders off the list is empty.
     */
    #[Authorize('viewSettings', 'company')]
    public function preview(Request $request, Company $company, DunningCandidates $candidates, Clock $clock): AnonymousResourceCollection
    {
        $request->validate(['date' => ['sometimes', 'date_format:Y-m-d']]);
        $today = $clock->now()->setTimezone(new DateTimeZone($company->timezone));
        $on = $request->query('date') !== null ? new DateTimeImmutable((string) $request->query('date')) : new DateTimeImmutable($today->modify('+1 day')->format('Y-m-d'));
        $enabled = (bool) CompanySettings::query()->where('company_id', $company->id)->value('dunning_enabled');

        return DunningPreviewResource::collection($enabled ? ($candidates)($company, $on) : [])
            ->additional(['meta' => ['date' => (string) $on->format('Y-m-d'), 'enabled' => $enabled]]);
    }
}
