<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Organisation\Inputs\CompanySettingsInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\UnitOfWork\VersionConflict;

/**
 * Company profile, tax rounding and posting accounts (`settings.manage`, people only). Country and base currency are set
 * when the company is created and never change (every posted amount is in that currency). A posting account must be an
 * active, postable account of this company, and the receivable, payable, tax and retained-earnings keys need a control
 * account of the matching type, so a posting cannot be pointed at the wrong ledger. Numbering prefixes are not
 * configurable yet (document numbers are gapless and their format is part of the posting engine); see plan 2.20.
 */
final class UpdateCompanySettings
{
    /** @var array<string, string|null> posting account key → control type it requires (null: any postable account) */
    public const array POSTING_KEYS = [
        'ar_control' => 'ar', 'ap_control' => 'ap', 'tax_output' => 'tax', 'tax_input' => 'tax', 'wht_payable' => 'tax',
        'retained_earnings' => 'retained_earnings', 'fx_realised' => null, 'fx_realised_loss' => null, 'fx_unrealised' => null, 'fx_unrealised_loss' => null, 'rounding' => null,
        'suspense' => null, 'bank_clearing' => null,
        // Added by plan 3c.8 onwards; a company on an older chart may lack them, and the documents that need them say so.
        'bank_in_transit' => 'cash', 'reverse_charge_output' => 'tax', 'reverse_charge_input' => 'tax', 'credit_loss_allowance' => null, 'bad_debt_expense' => null, 'bad_debt_recovery' => null,
        'asset_disposal_gain' => null, 'asset_disposal_loss' => null,
        'impairment_loss' => null, 'impairment_reversal' => null, 'revaluation_reserve' => null,
    ];

    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard) {}

    public function handle(Actor $actor, CompanySettingsInput $in): CompanySettings
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            if ($actor->isApiClient()) {
                throw DomainRuleViolation::single('forbidden', 'Company settings are changed by people.');
            }
            $this->guard->require($actor, 'settings.manage', $in->companyId);

            $company = Company::query()->whereKey($in->companyId)->lockForUpdate()->firstOrFail();
            $settings = CompanySettings::query()->where('company_id', $in->companyId)->lockForUpdate()->first()
                ?? (new CompanySettings)->forceFill(['tenant_id' => $actor->tenantId, 'company_id' => $in->companyId]);
            $server = (int) ($settings->getAttribute('lock_version') ?? 0);
            if ($in->version !== null && $in->version !== $server) {
                throw new VersionConflict($server, $in->version);
            }
            $before = ['company' => $company->only(array_keys($in->profile)), 'settings' => $settings->only(['credit_limit_mode', 'tax_rounding', 'posting_accounts', 'require_purchase_order', 'po_price_tolerance_pct', 'po_quantity_tolerance_pct', 'receipt_over_tolerance_pct', 'document_templates'])];

            if ($in->profile !== []) {
                $company->forceFill($in->profile)->save();
            }
            $posting = $this->postingAccounts($settings);
            foreach ($in->postingAccounts as $key => $accountId) {
                if (! array_key_exists($key, self::POSTING_KEYS)) {
                    throw DomainRuleViolation::single('posting_key_unknown', "There is no posting account called {$key}.");
                }
                if ($accountId === null) {
                    unset($posting[$key]);

                    continue;
                }
                $this->checkAccount($in->companyId, $key, $accountId);
                $posting[$key] = $accountId;
            }
            $settings->forceFill(['posting_accounts' => $posting]);
            if ($in->taxRounding !== null) {
                $settings->forceFill(['tax_rounding' => $in->taxRounding]);
            }
            if ($in->setsJournalThreshold) {
                $defaults = $settings->getAttribute('approval_defaults');
                $defaults = is_array($defaults) ? $defaults : [];
                $settings->forceFill(['approval_defaults' => array_filter(['journal_threshold' => $in->journalThreshold] + $defaults, fn ($v) => $v !== null)]);
            }
            foreach ([
                'require_purchase_order' => $in->requirePurchaseOrder, 'po_price_tolerance_pct' => $in->poPriceTolerancePct,
                'po_quantity_tolerance_pct' => $in->poQuantityTolerancePct, 'receipt_over_tolerance_pct' => $in->receiptOverTolerancePct,
                'credit_limit_mode' => $in->creditLimitMode,
            ] as $column => $value) {
                if ($value !== null) {
                    $settings->forceFill([$column => $value]);
                }
            }
            if ($in->documentLook !== []) {
                $settings->forceFill(['document_templates' => $this->documentLook($settings, $in->documentLook)]);
            }
            $settings->forceFill(['lock_version' => $server + 1])->save();
            $settings->refresh();

            $audit->add('company_settings.updated', $company, before: $before, after: ['company' => $company->only(array_keys($in->profile)), 'settings' => $settings->only(['credit_limit_mode', 'tax_rounding', 'posting_accounts', 'require_purchase_order', 'po_price_tolerance_pct', 'po_quantity_tolerance_pct', 'receipt_over_tolerance_pct', 'document_templates'])]);

            return $settings;
        });
    }

    /**
     * The stored look with the given keys replaced. A cleared footer or instruction is stored empty; email templates replace
     * their family as a whole.
     *
     * @param  array<string, mixed>  $change
     * @return array<string, mixed>
     */
    private function documentLook(CompanySettings $settings, array $change): array
    {
        $raw = $settings->getAttribute('document_templates');
        $raw = is_string($raw) ? json_decode($raw, true) : $raw;
        $stored = is_array($raw) ? $raw : [];
        foreach (['accent_color', 'footer_text', 'payment_instructions', 'sender_name', 'reply_to'] as $key) {
            if (array_key_exists($key, $change)) {
                $stored[$key] = $change[$key] === null ? '' : trim((string) $change[$key]);
            }
        }
        foreach ((array) ($change['email_templates'] ?? []) as $type => $template) {
            $stored['email'][$type] = ['subject' => trim((string) $template['subject']), 'body' => trim((string) $template['body'])];
        }

        return $stored;
    }

    /** @return array<string, string> */
    private function postingAccounts(CompanySettings $settings): array
    {
        $raw = $settings->getAttribute('posting_accounts');
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;

        return is_array($decoded) ? array_filter($decoded, 'is_string') : [];
    }

    private function checkAccount(string $companyId, string $key, string $accountId): void
    {
        $account = Account::query()->where('company_id', $companyId)->whereKey($accountId)->first();
        if ($account === null || ! $account->is_active || ! $account->is_postable) {
            throw DomainRuleViolation::single('posting_account_invalid', "The {$key} account must be an active, postable account of this company.");
        }
        $needs = self::POSTING_KEYS[$key];
        if ($needs !== null && $account->control_type->value !== $needs) {
            throw DomainRuleViolation::single('posting_account_wrong_control', "The {$key} account must be a {$needs} control account.");
        }
    }
}
