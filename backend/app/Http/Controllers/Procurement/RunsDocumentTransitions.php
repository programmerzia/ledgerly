<?php

declare(strict_types=1);

namespace App\Http\Controllers\Procurement;

use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Http\Requests\Ledger\ReturnJournalRequest;
use App\Http\Requests\Ledger\VoidJournalRequest;
use App\Http\Requests\TransitionRequest;
use App\Http\Support\RequestActor;
use App\Models\Organisation\Company;

/**
 * Submit, approve, return and void of a procurement document run through the shared workflow Actions, exactly as for
 * journals and bills; only the document type differs. The controller answers with the document it owns.
 */
trait RunsDocumentTransitions
{
    private function submitDocument(TransitionRequest $request, Company $company, string $type, string $id, SubmitDocument $action): void
    {
        $action->handle(RequestActor::from($request, $company->id), new DocumentRef($type, $id, $request->version()));
    }

    private function approveDocument(TransitionRequest $request, Company $company, string $type, string $id, ApproveDocument $action): void
    {
        $action->handle(RequestActor::from($request, $company->id), new DocumentRef($type, $id, $request->version()), $request->comment());
    }

    private function returnDocument(ReturnJournalRequest $request, Company $company, string $type, string $id, ReturnDocument $action): void
    {
        $action->handle(RequestActor::from($request, $company->id), new ReturnDocumentInput(new DocumentRef($type, $id, $request->version()), $request->comment()));
    }

    private function voidDocument(VoidJournalRequest $request, Company $company, string $type, string $id, VoidDocument $action): void
    {
        $action->handle(RequestActor::from($request, $company->id), new VoidDocumentInput(new DocumentRef($type, $id, $request->version()), $request->reason()));
    }
}
