<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\ApplyChartTemplateInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Platform\ChartTemplate;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use LogicException;

/**
 * Onboarding step 2 (02 §3): copies a chart template into a company that has no accounts yet.
 * Each template line becomes one account. A line that is another line's parent becomes a
 * non-postable group header; every other account is postable and active. Returns the number of
 * accounts created.
 *
 * @phpstan-import-type TemplateLine from ChartTemplate
 */
final class ApplyChartTemplate
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly PermissionChecker $permissions,
    ) {}

    public function handle(Actor $actor, ApplyChartTemplateInput $in): int
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            if (! $this->permissions->allows($actor, 'accounts.manage', $in->companyId)) {
                throw DomainRuleViolation::single('forbidden', 'You are not allowed to manage the chart of accounts.');
            }

            // Concurrent applies queue on the company row, so the second one finds the chart no longer
            // empty and is refused cleanly instead of failing on a duplicate account code. NO KEY UPDATE
            // does not block the foreign-key checks that postings run against the same row.
            $company = Company::query()->whereKey($in->companyId)->lock('FOR NO KEY UPDATE')->firstOrFail();

            $template = ChartTemplate::query()->where('code', $in->templateCode)->first();
            if ($template === null) {
                throw DomainRuleViolation::single('chart_template_not_found', "Unknown chart template {$in->templateCode}.");
            }

            // Soft-deleted accounts still own their codes, so they count.
            if (Account::query()->withTrashed()->where('company_id', $company->id)->exists()) {
                throw DomainRuleViolation::single('chart_not_empty', 'A chart template can only be applied to a company with no accounts.');
            }

            $rows = $this->accountRows($actor, $company, $template);
            Account::query()->insert($rows);
            $this->createDimensions($actor, $company, $template);
            $this->setPostingAccounts($actor, $company, $template);

            $audit->add('chart.applied', $company, context: ['template' => $template->code, 'accounts' => count($rows)]);

            return count($rows);
        });
    }

    /** The template's posting accounts, without overwriting any the company has already chosen. */
    private function setPostingAccounts(Actor $actor, Company $company, ChartTemplate $template): void
    {
        $idByCode = Account::query()->where('company_id', $company->id)->pluck('id', 'code')->all();
        $settings = CompanySettings::query()->where('company_id', $company->id)->first()
            ?? (new CompanySettings)->forceFill(['tenant_id' => $actor->tenantId, 'company_id' => $company->id]);
        $chosen = $settings->getAttribute('posting_accounts');
        $chosen = is_array($chosen) ? $chosen : [];

        foreach ($template->posting_accounts as $key => $code) {
            if (($chosen[$key] ?? '') === '' && isset($idByCode[$code])) {
                $chosen[$key] = $idByCode[$code];
            }
        }
        $settings->forceFill(['posting_accounts' => $chosen])->save();
    }

    /** Dimensions the template brings, placed after any the company already has. */
    private function createDimensions(Actor $actor, Company $company, ChartTemplate $template): void
    {
        $position = (int) Dimension::query()->where('company_id', $company->id)->max('position');
        foreach ($template->dimensions as $definition) {
            $dimension = new Dimension;
            $dimension->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id,
                'code' => $definition['code'], 'name' => $definition['name'], 'position' => ++$position,
            ])->save();
            foreach ($definition['values'] as [$code, $name]) {
                (new DimensionValue)->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id,
                    'dimension_id' => $dimension->id, 'code' => $code, 'name' => $name,
                ])->save();
            }
        }
    }

    /**
     * One row per template line, parents resolved to the new ids. A single multi-row INSERT is checked
     * against the parent foreign key at the end of the statement, so the line order does not matter.
     *
     * @return list<array<string, bool|string|null>>
     */
    private function accountRows(Actor $actor, Company $company, ChartTemplate $template): array
    {
        /** @var array<string, string> $idByCode */
        $idByCode = [];
        /** @var array<string, true> $headers */
        $headers = [];
        foreach ($template->lines as $line) {
            $idByCode[$line['code']] = $this->ids->next();
            if ($line['parent_code'] !== null) {
                $headers[$line['parent_code']] = true;
            }
        }

        $stamp = $this->clock->now()->format('Y-m-d H:i:sP');
        $rows = [];
        foreach ($template->lines as $line) {
            $parent = $line['parent_code'];
            if ($parent !== null && ! isset($idByCode[$parent])) {
                throw new LogicException("Chart template {$template->code} line {$line['code']} names the unknown parent {$parent}.");
            }

            $rows[] = [
                'id' => $idByCode[$line['code']],
                'tenant_id' => $actor->tenantId,
                'company_id' => $company->id,
                'code' => $line['code'],
                'name' => $line['name'],
                'account_type' => $line['account_type'],
                'account_subtype' => $line['account_subtype'],
                'normal_balance' => $line['normal_balance'],
                'parent_id' => $parent === null ? null : $idByCode[$parent],
                'currency_policy' => $line['currency_policy'],
                'control_type' => $line['control_type'],
                'is_postable' => ! isset($headers[$line['code']]),
                'description' => $line['description'],
                'ifrs_element' => $line['ifrs_element'] ?? null,
                'is_hidden' => $line['is_hidden'] ?? false,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ];
        }

        return $rows;
    }
}
