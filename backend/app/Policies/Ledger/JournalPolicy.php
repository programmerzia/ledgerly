<?php

declare(strict_types=1);

namespace App\Policies\Ledger;

use App\Domain\Ledger\JournalStatus;
use App\Models\Ledger\Journal;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Permission + document state + actor relationship (13 §7). Actions check again; this drives the
 * routes and the `can` hints. Maker ≠ checker: whoever created or submitted a journal never
 * approves it, whatever their role. API clients (token abilities `journals:read|write|submit`) may
 * read, draft and submit; approving, returning, reversing and voiding other people's work is for people.
 */
final class JournalPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'journals.view', 'journals:read');
    }

    public function view(Authenticatable $principal, Journal $journal): bool
    {
        return $this->context->can($principal, 'journals.view', 'journals:read', $journal->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'journals.create', 'journals:write');
    }

    public function update(Authenticatable $principal, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Draft
            && $this->context->can($principal, 'journals.create', 'journals:write', $journal->company_id);
    }

    public function submit(Authenticatable $principal, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Draft
            && $this->context->can($principal, 'journals.submit', 'journals:submit', $journal->company_id);
    }

    public function approve(Authenticatable $principal, Journal $journal): bool
    {
        return $principal instanceof User
            && $journal->status === JournalStatus::PendingApproval
            && ! in_array($principal->id, [$journal->created_by, $journal->submitted_by], true)
            && $this->context->allows($principal, 'journals.approve', $journal->company_id);
    }

    /** Returning to the maker is the approver's alternative to approving. */
    public function return(Authenticatable $principal, Journal $journal): bool
    {
        return $this->approve($principal, $journal);
    }

    /** Drafts and journals waiting for approval: the creator voids their own, an approver anyone's. */
    public function void(Authenticatable $principal, Journal $journal): bool
    {
        if (! in_array($journal->status, [JournalStatus::Draft, JournalStatus::PendingApproval], true)) {
            return false;
        }
        if ($journal->created_by === $principal->getAuthIdentifier()
            && $this->context->can($principal, 'journals.create', 'journals:write', $journal->company_id)) {
            return true;
        }

        return $this->context->personCan($principal, 'journals.approve', $journal->company_id);
    }

    public function reverse(Authenticatable $principal, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Posted
            && $journal->reversed_by_id === null
            && $this->context->personCan($principal, 'journals.reverse', $journal->company_id);
    }
}
