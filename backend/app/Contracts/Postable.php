<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Domain\Workflow\DocumentStatus;

/**
 * A document that goes through submit → approve → post (13 §10). Implemented by Journal now and by
 * Invoice, Settlement, PaymentRun, FxRevaluation and DepreciationRun as they land, so the workflow
 * Actions stay type-agnostic. Amounts are base-currency minor units.
 */
interface Postable
{
    public function documentType(): string;

    public function documentId(): string;

    public function documentCompanyId(): string;

    public function documentStatus(): DocumentStatus;

    public function documentAmount(): int;

    public function documentCreatedBy(): ?string;

    public function documentSubmittedBy(): ?string;

    public function documentLockVersion(): int;

    /**
     * Everything a signature vouches for: header and lines, no timestamps or statuses.
     *
     * @return array<string, mixed>
     */
    public function documentContent(): array;
}
