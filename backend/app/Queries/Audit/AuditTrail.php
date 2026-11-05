<?php

declare(strict_types=1);

namespace App\Queries\Audit;

use App\Support\Reports\ReportRunner;
use Generator;
use Illuminate\Database\Query\Builder;

/**
 * The audit trail report (3c.20): the company's audit events in time order, filtered, read on the reporting connection.
 * Filters: `from` / `to` (UTC days, inclusive), `action` (a full action or its prefix, so `invoice` matches
 * `invoice.posted`), `actor_id`, `subject_type`, `subject_id`. The same filters select the events of the tamper-evident
 * bundle (`AuditBundle`).
 */
final class AuditTrail
{
    public function __construct(private readonly ReportRunner $runner) {}

    /** @param array<string, mixed> $in */
    public function count(string $companyId, array $in): int
    {
        return (int) $this->filtered($companyId, $in)->count();
    }

    /**
     * Events with the actor's name, oldest first, read in chunks.
     *
     * @param  array<string, mixed>  $in
     * @return Generator<int, \stdClass>
     */
    public function rows(string $companyId, array $in): Generator
    {
        $after = 0;
        do {
            $rows = $this->filtered($companyId, $in)->where('e.id', '>', $after)->orderBy('e.id')->limit(1000)
                ->select('e.id', 'e.occurred_at', 'e.actor_type', 'e.actor_id', 'e.action', 'e.subject_type', 'e.subject_id', 'e.request_id', 'e.ip', 'e.hash')
                ->selectRaw("(SELECT u.name FROM users u WHERE u.id = e.actor_id AND e.actor_type IN ('user', 'admin_impersonating') LIMIT 1) AS actor_name")
                ->get();
            foreach ($rows as $r) {
                yield $r;
                $after = (int) $r->id;
            }
        } while ($rows->count() === 1000);
    }

    /**
     * The ids the filters select, ascending.
     *
     * @param  array<string, mixed>  $in
     * @return list<int>
     */
    public function ids(string $companyId, array $in): array
    {
        return array_values(array_map(fn (mixed $id): int => (int) $id, $this->filtered($companyId, $in)->orderBy('e.id')->pluck('e.id')->all()));
    }

    /** @param array<string, mixed> $in */
    private function filtered(string $companyId, array $in): Builder
    {
        $q = $this->runner->db()->table('audit_events as e')->where('e.company_id', $companyId);
        if (isset($in['from'])) {
            $q->where('e.occurred_at', '>=', $in['from'].' 00:00:00+00');
        }
        if (isset($in['to'])) {
            $q->where('e.occurred_at', '<', gmdate('Y-m-d', (int) strtotime($in['to'].' +1 day')).' 00:00:00+00');
        }
        if (isset($in['action'])) {
            $like = addcslashes((string) $in['action'], '\\%_');
            $q->where(fn (Builder $w) => $w->where('e.action', (string) $in['action'])->orWhere('e.action', 'like', $like.'.%'));
        }
        foreach (['actor_id', 'subject_type', 'subject_id'] as $key) {
            if (isset($in[$key])) {
                $q->where("e.{$key}", (string) $in[$key]);
            }
        }

        return $q;
    }
}
