<?php

declare(strict_types=1);

namespace App\Actions\Transactions;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Transactions\ProvisionMatrix;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Models\Transactions\ProvisionRun;
use App\Services\Transactions\ProvisionService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * The setup and the draft of provisioning: the rates per aging bucket (`provisions.manage`, replaced as a whole, audited) and a
 * run for an as-of date (`provisions.create`): its numbers are worked out now, stored with their detail, and checked again when it posts.
 */
final class ManageProvisioning
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly IdGenerator $ids,
        private readonly ProvisionService $service,
    ) {}

    /**
     * @param  array<string, string>  $ratesPct  bucket → percentage, all five buckets
     * @return array<string, string>
     */
    public function saveRates(Actor $actor, string $companyId, array $ratesPct): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $ratesPct) {
            if ($actor->isApiClient()) {
                throw DomainRuleViolation::single('forbidden', 'Provision rates are changed by people.');
            }
            $this->guard->require($actor, 'provisions.manage', $companyId);
            if (array_diff(ProvisionMatrix::BUCKETS, array_keys($ratesPct)) !== []) {
                throw DomainRuleViolation::single('provision_rates_incomplete', 'State a rate for every aging bucket.');
            }
            $before = $this->service->storedRates($companyId);
            $this->service->writeRates($actor->tenantId, $companyId, $ratesPct);
            $audit->add('provision_rates.updated', Company::query()->findOrFail($companyId), before: ['rates' => $before], after: ['rates' => $ratesPct]);

            return $this->service->rates($companyId);
        });
    }

    public function createRun(Actor $actor, string $companyId, DateTimeImmutable $asOf, ?string $memo): ProvisionRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $asOf, $memo) {
            $this->guard->require($actor, 'provisions.create', $companyId);
            $company = Company::query()->findOrFail($companyId);
            $period = FiscalPeriod::query()->where('company_id', $companyId)->where('kind', 'regular')
                ->where('starts_on', '<=', $asOf->format('Y-m-d'))->where('ends_on', '>=', $asOf->format('Y-m-d'))->first()
                ?? throw DomainRuleViolation::single('period_missing', 'No fiscal period covers the as-of date.');
            if ($period->status->value !== 'open') {
                throw DomainRuleViolation::single('period_closed', 'A provision runs in an open period.');
            }
            if (ProvisionRun::query()->where('company_id', $companyId)->where('fiscal_period_id', $period->id)->whereNotIn('status', ['void', 'reversed'])->exists()) {
                throw DomainRuleViolation::single('provision_run_exists', 'This period already has a provision run; reverse it first to run again.');
            }
            $numbers = $this->service->compute($company, $asOf);
            if ($numbers['difference'] === 0) {
                throw DomainRuleViolation::single('provision_no_difference', 'The allowance already equals what the rates require; there is nothing to post.');
            }

            $run = new ProvisionRun;
            $run->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'status' => DocumentStatus::Draft,
                'fiscal_period_id' => $period->id, 'as_of' => $asOf, 'required' => $numbers['required'], 'existing' => $numbers['existing'],
                'difference' => $numbers['difference'], 'detail' => $numbers['detail'], 'memo' => $memo, 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            $audit->add('provision_run.created', $run, after: $run);

            return $run;
        });
    }
}
