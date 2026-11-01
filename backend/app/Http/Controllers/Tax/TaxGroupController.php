<?php

declare(strict_types=1);

namespace App\Http\Controllers\Tax;

use App\Actions\Tax\ManageTaxGroup;
use App\Http\Controllers\Controller;
use App\Http\Requests\Tax\ListTaxGroupsRequest;
use App\Http\Requests\Tax\TaxGroupRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\TaxGroupResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;
use App\Models\Tax\TaxGroup;
use App\Queries\Tax\ListTaxGroups;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Tax groups: codes charged together, in sequence. */
final class TaxGroupController extends Controller
{
    #[Authorize('viewAny', TaxGroup::class)]
    public function index(ListTaxGroupsRequest $request, Company $company, ListTaxGroups $groups): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($groups($company->id, $request->active()), $request, 'code');

        return TaxGroupResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('create', TaxGroup::class)]
    public function store(TaxGroupRequest $request, Company $company, ManageTaxGroup $action): JsonResponse
    {
        $group = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new TaxGroupResource($group))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'taxGroup')]
    public function update(TaxGroupRequest $request, Company $company, TaxGroup $taxGroup, ManageTaxGroup $action): TaxGroupResource
    {
        return new TaxGroupResource($action->update(RequestActor::from($request, $company->id), $taxGroup->id, $request->version(), $request->toInput($taxGroup->code)));
    }

    #[Authorize('deactivate', 'taxGroup')]
    public function deactivate(VersionRequest $request, Company $company, TaxGroup $taxGroup, ManageTaxGroup $action): TaxGroupResource
    {
        return new TaxGroupResource($action->deactivate(RequestActor::from($request, $company->id), $taxGroup->id, $request->version()));
    }
}
