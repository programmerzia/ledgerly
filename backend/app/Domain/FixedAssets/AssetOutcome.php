<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

/**
 * What one document does to one asset: signed changes to its additive figures, absolute replacements for the others (`set`)
 * and the journal lines that book it. Lines name a role, not an account: the Action maps roles to the category's accounts and
 * the company's posting accounts. Roles: asset, accumulated, proceeds, gain, loss, reserve, retained, impairment_loss,
 * impairment_reversal.
 */
final readonly class AssetOutcome
{
    /**
     * @param  array<string, mixed>  $set
     * @param  list<LineSpec>  $lines
     * @param  array<string, int>  $facts  figures worth showing (carrying before/after, gain or loss, reserve used...)
     */
    public function __construct(
        public int $cost = 0,
        public int $depreciation = 0,
        public int $impairment = 0,
        public int $reserve = 0,
        public int $deficit = 0,
        public array $set = [],
        public array $lines = [],
        public array $facts = [],
    ) {}

    /** @param array<string, mixed> $more */
    public function withSet(array $more): self
    {
        return new self($this->cost, $this->depreciation, $this->impairment, $this->reserve, $this->deficit, [...$this->set, ...$more], $this->lines, $this->facts);
    }

    /** @return array<string, mixed> the stored form, compared again when the document posts */
    public function toArray(): array
    {
        return [
            'cost' => $this->cost, 'depreciation' => $this->depreciation, 'impairment' => $this->impairment, 'reserve' => $this->reserve,
            'deficit' => $this->deficit, 'set' => $this->set, 'facts' => $this->facts,
            'lines' => array_map(static fn (LineSpec $l): array => ['role' => $l->role, 'debit' => $l->debit, 'credit' => $l->credit], $this->lines),
        ];
    }
}
