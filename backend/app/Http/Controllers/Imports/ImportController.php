<?php

declare(strict_types=1);

namespace App\Http\Controllers\Imports;

use App\Actions\Imports\CreateImport;
use App\Actions\Imports\PreviewImport;
use App\Actions\Imports\PurgeImport;
use App\Actions\Imports\RequestImportApply;
use App\Actions\Imports\SetImportMapping;
use App\Http\Controllers\Controller;
use App\Http\Requests\Imports\ListImportsRequest;
use App\Http\Requests\Imports\MappingRequest;
use App\Http\Requests\Imports\UploadImportRequest;
use App\Http\Resources\ImportResource;
use App\Http\Resources\ImportRowResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Imports\Import;
use App\Models\Imports\ImportRow;
use App\Models\Organisation\Company;
use App\Policies\Imports\ImportPolicy;
use App\Services\Imports\ImportKinds;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Data imports (plan 2.18): upload a CSV or XLSX, map its columns, preview every row, then apply on the queue. People only (an API token
 * is refused); the permission depends on the kind (contacts.manage, accounts.manage, invoices.create, banking.reconcile, and
 * settings.manage plus a signing grant for opening balances). The file is not kept, only its rows, until purged.
 */
final class ImportController extends Controller
{
    #[Authorize('viewAny', Import::class)]
    public function index(ListImportsRequest $request, Company $company, ImportPolicy $policy): AnonymousResourceCollection
    {
        $principal = call_user_func($request->getUserResolver());
        $query = Import::query()->where('company_id', $company->id)
            ->whereIn('kind', $principal instanceof Authenticatable ? $policy->kindsFor($principal) : [])
            ->when($request->kind() !== null, fn ($q) => $q->where('kind', $request->kind()))
            ->when($request->status() !== null, fn ($q) => $q->where('status', $request->status()));
        $page = CursorPage::fetch($query, $request, 'id', descending: true, kind: 'uuid');

        return ImportResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** What can be imported: each kind, its target fields (required or not), permission, and whether it is all-or-nothing. */
    #[Authorize('viewAny', Import::class)]
    public function kinds(Company $company, ImportKinds $kinds): JsonResponse
    {
        return response()->json(['data' => array_map(function (string $key) use ($kinds): array {
            $kind = $kinds->get($key);

            return [
                'kind' => $key,
                'permission' => $kind->permission(),
                'all_or_nothing' => $kind->atomic(),
                'needs_signature' => $kind->needsSignature(),
                'fields' => array_map(fn ($f) => $f->toArray(), $kind->fields()),
            ];
        }, ImportKinds::keys())]);
    }

    #[Authorize('view', 'import')]
    public function show(Company $company, Import $import): ImportResource
    {
        return new ImportResource($import);
    }

    /**
     * Upload a file and get its columns, the row count and a suggested mapping (the last one used for this kind when it still fits,
     * else guessed from the header names). Nothing is written to the books.
     */
    #[Authorize('create', Import::class)]
    public function store(UploadImportRequest $request, Company $company, CreateImport $action): JsonResponse
    {
        $import = $action->handle(RequestActor::user($request, $company->id), $request->toInput());

        return (new ImportResource($import))->response()->setStatusCode(201);
    }

    /** Set which column feeds which field. Clears any earlier preview. */
    #[Authorize('update', 'import')]
    public function mapping(MappingRequest $request, Company $company, Import $import, SetImportMapping $action): ImportResource
    {
        return new ImportResource($action->handle(RequestActor::user($request, $company->id), $import->id, $request->version(), $request->toInput()));
    }

    /** Check every row with the rules of the Action that will write it. Writes nothing to the books; rows carry numbered errors. */
    #[Authorize('update', 'import')]
    public function preview(Request $request, Company $company, Import $import, PreviewImport $action): ImportResource
    {
        return new ImportResource($action->handle(RequestActor::user($request, $company->id), $import->id));
    }

    /**
     * Apply the previewed import on the `imports` queue; answers 202 with the import (queued). Asking again changes nothing. Opening
     * balances need a signing grant now, and apply all rows or none.
     */
    #[Authorize('apply', 'import')]
    public function apply(Request $request, Company $company, Import $import, RequestImportApply $action): JsonResponse|ImportResource
    {
        $result = $action->handle(RequestActor::user($request, $company->id), $import->id);
        if ($result->status === 'queued') {
            return (new ImportResource($result))->response()->setStatusCode(202);
        }

        return new ImportResource($result);
    }

    /** The rows with their cells (safe for spreadsheets), numbered errors and what each created. Filter by `status`. */
    #[Authorize('view', 'import')]
    public function rows(ListImportsRequest $request, Company $company, Import $import): AnonymousResourceCollection
    {
        $query = ImportRow::query()->where('import_id', $import->id)->when($request->status() !== null, fn ($q) => $q->where('status', $request->status()));
        $page = CursorPage::fetch($query, $request, 'row_number', kind: 'int');

        return ImportRowResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** Clear the cell text of the rows (retention); their status, errors and results stay. A purged import cannot be applied. */
    #[Authorize('purge', 'import')]
    public function purge(Request $request, Company $company, Import $import, PurgeImport $action): ImportResource
    {
        return new ImportResource($action->handle(RequestActor::user($request, $company->id), $import->id));
    }
}
