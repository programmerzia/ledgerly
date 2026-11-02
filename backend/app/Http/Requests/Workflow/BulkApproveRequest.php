<?php

declare(strict_types=1);

namespace App\Http\Requests\Workflow;

use App\Actions\Workflow\BulkApproveDocuments;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Http\Requests\CompanyRequest;
use App\Services\Workflow\Documents;
use Illuminate\Validation\Rule;

/** `{documents: [{type, id}, …]}`, up to 50, approved on the caller's signing grant. */
final class BulkApproveRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'documents' => ['required', 'array', 'min:1', 'max:'.BulkApproveDocuments::MAX],
            'documents.*.type' => ['required', 'string', Rule::in(Documents::TYPES)],
            'documents.*.id' => ['required', 'uuid'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /** @return list<DocumentRef> */
    public function documents(): array
    {
        /** @var list<array{type: string, id: string}> $documents */
        $documents = $this->validated()['documents'];

        return array_map(fn (array $d): DocumentRef => new DocumentRef($d['type'], $d['id']), $documents);
    }

    public function comment(): ?string
    {
        $v = $this->validated();

        return isset($v['comment']) ? (string) $v['comment'] : null;
    }
}
