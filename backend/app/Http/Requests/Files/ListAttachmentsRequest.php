<?php

declare(strict_types=1);

namespace App\Http\Requests\Files;

use App\Http\Requests\CompanyRequest;
use App\Models\BaseModel;
use App\Support\Files\AttachableTypes;
use Closure;
use Illuminate\Validation\Rule;

/** GET …/attachments?attachable_type=&attachable_id=: the files of one parent. */
final class ListAttachmentsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'attachable_type' => ['required', 'string', Rule::in(AttachableTypes::names())],
            'attachable_id' => ['bail', 'required', 'uuid', function (string $attribute, mixed $value, Closure $fail): void {
                $type = $this->query('attachable_type');
                if (is_string($type) && in_array($type, AttachableTypes::names(), true)
                    && AttachableTypes::find($type, $this->company()->id, (string) $value) === null) {
                    $fail('The selected :attribute does not exist in this company.');
                }
            }],
        ];
    }

    public function type(): string
    {
        return (string) $this->validated()['attachable_type'];
    }

    public function parent(): BaseModel
    {
        return AttachableTypes::find($this->type(), $this->company()->id, (string) $this->validated()['attachable_id'])
            ?? throw new \LogicException('Validated parent vanished.');
    }
}
