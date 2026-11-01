<?php

declare(strict_types=1);

namespace App\Policies\Files;

use App\Domain\Files\ScanStatus;
use App\Models\BaseModel;
use App\Models\Files\Attachment;
use App\Policies\PolicyContext;
use App\Support\Files\AttachableTypes;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Files on documents and contacts (13 §7, 13 §17). A person needs the parent's module permissions (view to read;
 * view and create/manage to add or remove, see AttachableTypes); an API client needs `attachments:read` or
 * `attachments:write`. Removing is further refused once the parent is posted (evidence, 02 §5). Actions check again.
 */
final class AttachmentPolicy
{
    /** @var array<string, BaseModel|null> */
    private array $parents = [];

    public function __construct(private readonly PolicyContext $context) {}

    /** The route-level gate: may this principal read attachments of at least one kind of parent? */
    public function viewAny(Authenticatable $principal): bool
    {
        foreach (AttachableTypes::names() as $type) {
            if ($this->context->can($principal, AttachableTypes::viewPermission($type), 'attachments:read')) {
                return true;
            }
        }

        return false;
    }

    public function create(Authenticatable $principal): bool
    {
        foreach (AttachableTypes::names() as $type) {
            if ($this->context->can($principal, AttachableTypes::writePermission($type), 'attachments:write')) {
                return true;
            }
        }

        return false;
    }

    /** List the files of a parent: the parent's view permission. The parent was looked up in the request's company, which the checks default to. */
    public function viewFor(Authenticatable $principal, string $type, BaseModel $parent): bool
    {
        return $this->context->can($principal, AttachableTypes::viewPermission($type, $parent), 'attachments:read');
    }

    /** Add a file to a parent: its view and its create/manage permission. */
    public function attachTo(Authenticatable $principal, string $type, BaseModel $parent): bool
    {
        return $this->context->can($principal, AttachableTypes::viewPermission($type, $parent), 'attachments:read')
            && $this->context->can($principal, AttachableTypes::writePermission($type, $parent), 'attachments:write');
    }

    public function view(Authenticatable $principal, Attachment $attachment): bool
    {
        $parent = $this->parentOf($attachment);

        return $parent !== null && $this->context->can($principal, AttachableTypes::viewPermission($attachment->attachable_type, $parent), 'attachments:read', $attachment->company_id);
    }

    public function download(Authenticatable $principal, Attachment $attachment): bool
    {
        return $attachment->scan_status === ScanStatus::Clean && $this->view($principal, $attachment);
    }

    public function complete(Authenticatable $principal, Attachment $attachment): bool
    {
        return $this->mayWrite($principal, $attachment);
    }

    public function delete(Authenticatable $principal, Attachment $attachment): bool
    {
        $parent = $this->parentOf($attachment);

        return $parent !== null && ! AttachableTypes::isPosted($parent) && $this->mayWrite($principal, $attachment, $parent);
    }

    private function mayWrite(Authenticatable $principal, Attachment $attachment, ?BaseModel $parent = null): bool
    {
        $parent ??= $this->parentOf($attachment);

        return $parent !== null && $this->attachTo($principal, $attachment->attachable_type, $parent);
    }

    /** The parent, looked up once per attachment per request (resources ask for several hints). */
    private function parentOf(Attachment $attachment): ?BaseModel
    {
        return $this->parents[$attachment->id] ??= AttachableTypes::find($attachment->attachable_type, $attachment->company_id, $attachment->attachable_id);
    }
}
