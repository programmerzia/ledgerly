<?php

declare(strict_types=1);

namespace App\Http\Requests\Files;

use App\Actions\Files\Inputs\UploadIntentInput;
use App\Http\Requests\CompanyRequest;
use App\Models\BaseModel;
use App\Support\Files\AttachableTypes;
use Closure;
use Illuminate\Validation\Rule;

/** POST …/attachments/uploads: what is being attached to, and the file's name, claimed type, size and SHA-256. */
final class UploadIntentRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'attachable_type' => ['required', 'string', Rule::in(AttachableTypes::names())],
            'attachable_id' => ['bail', 'required', 'uuid', $this->parentExists()],
            'filename' => ['required', 'string', 'min:1', 'max:255'],
            'mime' => ['required', 'string', Rule::in((array) config('attachments.mimes'))],
            'size' => ['required', 'integer', 'min:1', 'max:'.(int) config('attachments.max_bytes')],
            'sha256' => ['required', 'string', 'regex:/^[0-9a-fA-F]{64}$/'],
        ];
    }

    /** The parent must exist in this company: another company's id is a 422, like an unknown one. */
    public function parentExists(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $type = $this->input('attachable_type', $this->query('attachable_type'));
            if (! is_string($type) || ! in_array($type, AttachableTypes::names(), true)) {
                return; // the type rule reports it
            }
            if (AttachableTypes::find($type, $this->company()->id, (string) $value) === null) {
                $fail('The selected :attribute does not exist in this company.');
            }
        };
    }

    public function parent(): BaseModel
    {
        $v = $this->validated();

        return AttachableTypes::find((string) $v['attachable_type'], $this->company()->id, (string) $v['attachable_id'])
            ?? throw new \LogicException('Validated parent vanished.');
    }

    public function toInput(): UploadIntentInput
    {
        $v = $this->validated();

        return new UploadIntentInput(
            companyId: $this->company()->id,
            attachableType: (string) $v['attachable_type'],
            attachableId: (string) $v['attachable_id'],
            filename: (string) $v['filename'],
            mime: (string) $v['mime'],
            size: (int) $v['size'],
            sha256: strtolower((string) $v['sha256']),
        );
    }
}
