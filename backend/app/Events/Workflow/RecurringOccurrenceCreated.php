<?php

declare(strict_types=1);

namespace App\Events\Workflow;

use App\Contracts\OutboxEvent;

/** A recurring schedule created the draft for one occurrence (doc 14 E2). The draft still needs submitting and approving. */
final readonly class RecurringOccurrenceCreated implements OutboxEvent
{
    public function __construct(
        public string $documentType,
        public string $documentId,
        public string $companyId,
        public string $scheduleType,
        public string $scheduleId,
        public string $occurrenceDate,
    ) {}

    public function type(): string
    {
        return 'recurring.occurrence_created';
    }

    public function payload(): array
    {
        return [
            'document_type' => $this->documentType, 'document_id' => $this->documentId, 'company_id' => $this->companyId, 'version' => 0,
            'schedule_type' => $this->scheduleType, 'schedule_id' => $this->scheduleId, 'occurrence_date' => $this->occurrenceDate,
        ];
    }
}
