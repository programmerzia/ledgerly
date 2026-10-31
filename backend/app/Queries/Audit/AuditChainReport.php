<?php

declare(strict_types=1);

namespace App\Queries\Audit;

/** Outcome of `VerifyAuditChain`. `problem` is a stable code; `brokenAtId` the first bad event. */
final readonly class AuditChainReport
{
    public function __construct(
        public bool $intact,
        public int $eventsChecked,
        public ?int $startedAfterId,
        public ?int $brokenAtId = null,
        public ?string $problem = null,
        public ?string $detail = null,
    ) {}

    public static function broken(int $checked, ?int $startedAfterId, ?int $atId, string $problem, string $detail): self
    {
        return new self(false, $checked, $startedAfterId, $atId, $problem, $detail);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'intact' => $this->intact,
            'events_checked' => $this->eventsChecked,
            'started_after_id' => $this->startedAfterId,
            'broken_at_id' => $this->brokenAtId,
            'problem' => $this->problem,
            'detail' => $this->detail,
        ];
    }
}
