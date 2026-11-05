<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\FixedAssets\AssetOutcome;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Account;
use App\Models\Organisation\CompanySettings;
use DateTimeImmutable;

/**
 * Builds the journals that fixed asset documents post, and looks up the company's posting accounts for them. A posting
 * key the chart does not have is refused with a message that names it: no account is ever guessed.
 */
final class AssetJournals
{
    /** The label shown when a posting key is missing. */
    private const array LABELS = [
        'asset_disposal_gain' => 'gain on disposal of assets', 'asset_disposal_loss' => 'loss on disposal of assets',
        'impairment_loss' => 'impairment loss', 'impairment_reversal' => 'reversal of impairment loss',
        'revaluation_reserve' => 'revaluation reserve', 'retained_earnings' => 'retained earnings',
    ];

    /** @var array<string, array<string, string>> */
    private array $cache = [];

    /**
     * Dr depreciation expense, Cr accumulated depreciation, one pair of lines per asset, on the asset's category accounts and
     * with the asset's dimensions.
     *
     * @param  list<array{asset: FixedAsset, category: AssetCategory, amount: int}>  $items
     */
    public function depreciation(DepreciationRun $run, array $items, string $reference): JournalDraft
    {
        $lines = [];
        foreach ($items as $item) {
            if ($item['amount'] <= 0) {
                continue;
            }
            $label = "{$item['asset']->number} {$item['asset']->name}";
            $dims = array_filter($item['asset']->dimensions(), static fn (?string $v): bool => $v !== null);
            $lines[] = new DraftLine($item['category']->expense_account_id, debit: $item['amount'], dims: $dims, description: "Depreciation: {$label}");
            $lines[] = new DraftLine($item['category']->accumulated_account_id, credit: $item['amount'], dims: $dims, description: "Accumulated depreciation: {$label}");
        }

        return new JournalDraft(
            $run->company_id, JournalType::Depreciation, DateTimeImmutable::createFromInterface($run->as_of), $lines,
            $reference, 'Depreciation for the period ending '.$run->as_of->format('Y-m-d'), 'depreciation_run', $run->id,
        );
    }

    /**
     * The journal of a disposal, impairment, impairment reversal or revaluation: each asset's lines (see AssetOutcome), on the
     * category's accounts for cost and accumulated depreciation, the chosen account for proceeds, and the company's posting
     * accounts for the rest, with the asset's dimensions on every line.
     *
     * @param  list<array{asset: FixedAsset, category: AssetCategory, outcome: AssetOutcome}>  $items
     */
    public function transaction(AssetTransaction $tx, array $items, string $reference): JournalDraft
    {
        $lines = [];
        $revalued = false;
        $verb = ['disposal' => 'Disposal', 'impairment' => 'Impairment', 'impairment_reversal' => 'Impairment reversal', 'revaluation' => 'Revaluation'][$tx->kind] ?? $tx->kind;
        foreach ($items as $item) {
            $revalued = $revalued || $item['category']->isRevalued();
            $dims = array_filter($item['asset']->dimensions(), static fn (?string $v): bool => $v !== null);
            $label = "{$verb}: {$item['asset']->number} {$item['asset']->name}";
            foreach ($item['outcome']->lines as $spec) {
                $account = match ($spec->role) {
                    'asset' => $item['category']->asset_account_id,
                    'accumulated' => $item['category']->accumulated_account_id,
                    'proceeds' => (string) ($tx->params['proceeds_account_id'] ?? throw DomainRuleViolation::single('proceeds_account_required', 'Choose the account the proceeds go to.')),
                    'gain' => $this->account($tx->company_id, 'asset_disposal_gain'),
                    'loss' => $this->account($tx->company_id, 'asset_disposal_loss'),
                    'reserve' => $this->account($tx->company_id, 'revaluation_reserve'),
                    'retained' => $this->account($tx->company_id, 'retained_earnings'),
                    'impairment_loss' => $this->account($tx->company_id, 'impairment_loss'),
                    'impairment_reversal' => $this->account($tx->company_id, 'impairment_reversal'),
                    default => throw new \LogicException("Unknown line role {$spec->role}."),
                };
                $lines[] = new DraftLine($account, debit: $spec->debit, credit: $spec->credit, dims: $dims, description: $label);
            }
        }

        return new JournalDraft(
            $tx->company_id, JournalType::Asset, DateTimeImmutable::createFromInterface($tx->tx_date), $lines,
            $reference, trim("{$verb} {$tx->reason}"), $tx->journalSource($revalued), $tx->id,
        );
    }

    /** The account configured for a posting key, or a clear refusal. */
    public function account(string $companyId, string $key): string
    {
        return $this->accounts($companyId)[$key] ?? throw DomainRuleViolation::single(
            'posting_account_missing',
            'Set the '.(self::LABELS[$key] ?? $key)." account (posting key {$key}) in the company settings before posting this; the chart does not have one set.",
        );
    }

    /** @return array<string, string> posting key → account id, for the keys that resolve to an account of this company */
    private function accounts(string $companyId): array
    {
        if (isset($this->cache[$companyId])) {
            return $this->cache[$companyId];
        }
        $raw = CompanySettings::query()->where('company_id', $companyId)->first()?->getAttribute('posting_accounts');
        /** @var array<string, mixed> $settings */
        $settings = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $out = [];
        foreach ($settings as $key => $ref) {
            if (! is_string($ref) || $ref === '') {
                continue;
            }
            $account = Account::query()->where('company_id', $companyId)->where(fn ($q) => $q->where('code', $ref)->when(
                preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $ref) === 1,
                fn ($q2) => $q2->orWhere('id', $ref),
            ))->first();
            if ($account !== null) {
                $out[(string) $key] = $account->id;
            }
        }

        return $this->cache[$companyId] = $out;
    }
}
