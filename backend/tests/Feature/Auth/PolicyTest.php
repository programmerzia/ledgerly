<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Domain\Ledger\JournalStatus;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Platform\User;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Tests\Support\LedgerFixture;

/*
 * Policies (13 §7) combine the company permission, the document state and the actor's relation to
 * the document. Maker ≠ checker holds for every role.
 */

/** A member of the fixture's tenant holding $role in its company. */
function memberWithRole(LedgerFixture $f, string $name, ?string $role): User
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => strtolower($name).'@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    if ($role !== null) {
        app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($id, $f->companyId, $role));
    }

    return User::query()->findOrFail($id);
}

function journalIn(LedgerFixture $f, JournalStatus $status, ?string $createdBy = null, ?string $submittedBy = null): Journal
{
    return (new Journal)->forceFill([
        'id' => (string) Str::uuid7(), 'company_id' => $f->companyId, 'status' => $status,
        'created_by' => $createdBy, 'submitted_by' => $submittedBy, 'reversed_by_id' => null,
    ]);
}

beforeEach(function (): void {
    $this->f = LedgerFixture::create();
    app(SeedCompanyRoles::class)->handle($this->f->actor, $this->f->companyId);
    app(CompanyContext::class)->set($this->f->companyId);
    $this->accountant = memberWithRole($this->f, 'Accountant', 'Accountant');
    $this->approver = memberWithRole($this->f, 'Approver', 'Approver');
    $this->viewer = memberWithRole($this->f, 'Viewer', 'Viewer');
});

afterEach(function (): void {
    app(CompanyContext::class)->clear();
});

it('lets the accountant draft and submit but not approve or reverse', function (): void {
    $draft = journalIn($this->f, JournalStatus::Draft, $this->accountant->id);
    $posted = journalIn($this->f, JournalStatus::Posted, $this->accountant->id);
    $gate = Gate::forUser($this->accountant);

    expect($gate->allows('create', Journal::class))->toBeTrue()
        ->and($gate->allows('update', $draft))->toBeTrue()
        ->and($gate->allows('submit', $draft))->toBeTrue()
        ->and($gate->allows('approve', journalIn($this->f, JournalStatus::PendingApproval, $this->viewer->id)))->toBeFalse()
        ->and($gate->allows('reverse', $posted))->toBeFalse()
        ->and($gate->allows('update', $posted))->toBeFalse();
});

it('lets an approver approve or return pending journals of others only', function (): void {
    $gate = Gate::forUser($this->approver);
    $others = journalIn($this->f, JournalStatus::PendingApproval, $this->accountant->id, $this->accountant->id);

    expect($gate->allows('approve', $others))->toBeTrue()
        ->and($gate->allows('return', $others))->toBeTrue()
        ->and($gate->allows('approve', journalIn($this->f, JournalStatus::Draft, $this->accountant->id)))->toBeFalse()
        ->and($gate->allows('create', Journal::class))->toBeFalse();
});

it('never lets the maker or the submitter approve, even as Owner', function (): void {
    $owner = User::query()->findOrFail($this->f->userId);
    app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($owner->id, $this->f->companyId, 'Owner'));
    $gate = Gate::forUser($owner);

    expect($gate->allows('approve', journalIn($this->f, JournalStatus::PendingApproval, $owner->id)))->toBeFalse()
        ->and($gate->allows('approve', journalIn($this->f, JournalStatus::PendingApproval, $this->accountant->id, $owner->id)))->toBeFalse()
        ->and($gate->allows('approve', journalIn($this->f, JournalStatus::PendingApproval, $this->accountant->id, $this->accountant->id)))->toBeTrue()
        ->and($gate->allows('reverse', journalIn($this->f, JournalStatus::Posted, $this->accountant->id)))->toBeTrue();
});

it('gives viewers read access only, and denies everything without a company or tenant', function (): void {
    $gate = Gate::forUser($this->viewer);
    expect($gate->allows('viewAny', Journal::class))->toBeTrue()
        ->and($gate->allows('create', Journal::class))->toBeFalse();

    app(CompanyContext::class)->clear();
    expect(Gate::forUser($this->accountant)->allows('create', Journal::class))->toBeFalse();

    app(CompanyContext::class)->set($this->f->companyId);
    app(TenantContext::class)->clear();
    expect(Gate::forUser($this->accountant)->allows('create', Journal::class))->toBeFalse();
});

it('reserves organisation actions for owners and admins', function (): void {
    $owner = User::query()->findOrFail($this->f->userId);

    expect(Gate::forUser($owner)->allows('create', Company::class))->toBeTrue()
        ->and(Gate::forUser($owner)->allows('viewAny', Invitation::class))->toBeTrue()
        ->and(Gate::forUser($this->accountant)->allows('create', Company::class))->toBeFalse()
        ->and(Gate::forUser($this->accountant)->allows('create', Invitation::class))->toBeFalse()
        ->and(Gate::forUser($this->accountant)->allows('viewAny', Company::class))->toBeTrue();
});
