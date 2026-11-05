<?php

declare(strict_types=1);

namespace App\Services\Notifications;

use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\Postable;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Workflow\ApprovalRequest;
use App\Services\Workflow\Documents;
use Illuminate\Database\Eloquent\Model;

/**
 * Who a document is waiting for and how to name it. The current step is the lowest step with a pending slot; its
 * approvers are the holders of the step's role, without the people who made the document (maker ≠ checker) and without
 * anyone who already signed an earlier step (the approvals inbox applies the same two rules).
 */
final class ApprovalAudience
{
    /** Where a document is opened inside the company (the SPA adds the company). */
    private const array LINKS = [
        'journal' => 'journals/%s', 'invoice' => 'invoices/%s', 'bill' => 'bills/%s', 'payment_run' => 'payment-run/%s',
        'purchase_requisition' => 'requisitions/%s', 'purchase_order' => 'purchase-orders/%s',
    ];

    private const array LABELS = [
        'journal' => 'Journal', 'invoice' => 'Invoice', 'bill' => 'Bill', 'settlement' => 'Payment', 'payment_run' => 'Payment run',
        'purchase_requisition' => 'Purchase requisition', 'purchase_order' => 'Purchase order', 'purchase_order_revision' => 'Purchase order revision',
    ];

    public function __construct(private readonly Documents $documents, private readonly RoleHolders $holders) {}

    public function find(string $type, string $id): (Postable&Model)|null
    {
        try {
            return $this->documents->find(new DocumentRef($type, $id));
        } catch (DomainRuleViolation) {
            return null;
        }
    }

    /** "Invoice INV-0003", or the plain type while the document has no number yet. */
    public function label(string $type, Model $doc): string
    {
        $number = $doc->getAttribute('number');
        $name = self::LABELS[$type] ?? ucfirst(str_replace('_', ' ', $type));

        return is_string($number) && $number !== '' ? "{$name} {$number}" : $name;
    }

    public function link(string $type, string $id): string
    {
        return isset(self::LINKS[$type]) ? sprintf(self::LINKS[$type], $id) : 'approvals';
    }

    /** @return list<string> the people who made the document */
    public function makers(Postable $doc): array
    {
        return array_values(array_unique(array_filter([$doc->documentCreatedBy(), $doc->documentSubmittedBy()], fn (?string $id) => $id !== null)));
    }

    /**
     * @return array{step: int, role: string, approvers: list<string>}|null null when nothing is pending
     */
    public function currentStep(string $type, Postable $doc): ?array
    {
        $pending = ApprovalRequest::query()->where('document_type', $type)->where('document_id', $doc->documentId())->where('status', 'pending')
            ->orderBy('step')->orderBy('slot')->first();
        if ($pending === null || $doc->documentStatus() !== DocumentStatus::PendingApproval) {
            return null;
        }
        $signed = ApprovalRequest::query()->where('document_type', $type)->where('document_id', $doc->documentId())->whereNotNull('signed_by')->pluck('signed_by')->all();
        $exclude = [...$this->makers($doc), ...array_map('strval', $signed)];

        return [
            'step' => $pending->step, 'role' => $pending->role,
            'approvers' => array_values(array_diff($this->holders->of($doc->documentCompanyId(), $pending->role), $exclude)),
        ];
    }
}
