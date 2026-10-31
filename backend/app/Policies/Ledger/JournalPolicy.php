<?php

declare(strict_types=1);

namespace App\Policies\Ledger;

use App\Domain\Ledger\JournalStatus;
use App\Models\Ledger\Journal;
use App\Models\Platform\User;
use App\Policies\PolicyContext;

/**
 * Permission + document state + actor relationship (13 §7). Actions check again; this drives the
 * routes and the `can` hints. Maker ≠ checker: whoever created or submitted a journal never
 * approves it, whatever their role.
 */
final class JournalPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(User $user): bool
    {
        return $this->context->allows($user, 'journals.view');
    }

    public function view(User $user, Journal $journal): bool
    {
        return $this->context->allows($user, 'journals.view', $journal->company_id);
    }

    public function create(User $user): bool
    {
        return $this->context->allows($user, 'journals.create');
    }

    public function update(User $user, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Draft
            && $this->context->allows($user, 'journals.create', $journal->company_id);
    }

    public function submit(User $user, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Draft
            && $this->context->allows($user, 'journals.submit', $journal->company_id);
    }

    public function approve(User $user, Journal $journal): bool
    {
        return $journal->status === JournalStatus::PendingApproval
            && ! in_array($user->id, [$journal->created_by, $journal->submitted_by], true)
            && $this->context->allows($user, 'journals.approve', $journal->company_id);
    }

    /** Returning to the maker is the approver's alternative to approving. */
    public function return(User $user, Journal $journal): bool
    {
        return $this->approve($user, $journal);
    }

    public function reverse(User $user, Journal $journal): bool
    {
        return $journal->status === JournalStatus::Posted
            && $journal->reversed_by_id === null
            && $this->context->allows($user, 'journals.reverse', $journal->company_id);
    }
}
