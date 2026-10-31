<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Platform\Currency;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Str;

/**
 * Onboarding step 1 (02 §3): creates a company with its settings, the seven roles, the creator as
 * Owner and the fiscal year containing today. Only org owners and admins may do this.
 */
final class CreateCompany
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly SeedCompanyRoles $seedRoles,
        private readonly AssignCompanyRole $assignRole,
        private readonly CreateFiscalYear $createYear,
    ) {}

    public function handle(Actor $actor, CreateCompanyInput $in): Company
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can create companies.');

            $currency = mb_strtoupper($in->baseCurrency);
            if (! Currency::query()->whereKey($currency)->exists()) {
                throw DomainRuleViolation::single('currency_not_found', "Unknown currency {$currency}.");
            }

            $company = new Company;
            $company->forceFill([
                'id' => $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'name' => $in->name,
                'legal_name' => $in->legalName,
                'slug' => $this->uniqueSlug($in->name),
                'country' => mb_strtoupper($in->country),
                'base_currency' => $currency,
                'timezone' => $in->timezone,
                'fiscal_year_start_month' => $in->fiscalYearStartMonth,
                'tax_id' => $in->taxId,
                'status' => 'active',
            ])->save();
            $company->refresh();

            (new CompanySettings)->forceFill(['tenant_id' => $actor->tenantId, 'company_id' => $company->id])->save();

            $scoped = new Actor(
                $actor->type, $actor->id, $actor->tenantId, $company->id, $actor->hasSigningGrant,
                $actor->ip, $actor->userAgent, $actor->requestId, $actor->idempotencyKey,
            );
            $this->seedRoles->handle($scoped, $company->id);
            $this->assignRole->handle($scoped, new CompanyRoleInput((string) $actor->id, $company->id, 'Owner'));

            $start = $this->currentYearStart($in->fiscalYearStartMonth, $in->timezone);
            $this->createYear->handle($scoped, new CreateFiscalYearInput($company->id, $start, self::yearName($start, $in->fiscalYearStartMonth)));

            $audit->add('company.created', $company, after: $company);

            return $company;
        });
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name);
        $base = $base === '' ? 'company' : $base;
        $taken = Company::query()->where('slug', 'like', $base.'%')->pluck('slug')->all();

        $slug = $base;
        for ($n = 2; in_array($slug, $taken, true); $n++) {
            $slug = "{$base}-{$n}";
        }

        return $slug;
    }

    private function currentYearStart(int $month, string $timezone): DateTimeImmutable
    {
        $today = $this->clock->now()->setTimezone(new DateTimeZone($timezone))->setTime(0, 0);
        $start = $today->setDate((int) $today->format('Y'), $month, 1);

        return $start > $today ? $start->modify('-1 year') : $start;
    }

    private static function yearName(DateTimeImmutable $start, int $month): string
    {
        $year = (int) $start->format('Y');

        return $month === 1 ? "FY{$year}" : 'FY'.$year.'/'.substr((string) ($year + 1), -2);
    }
}
