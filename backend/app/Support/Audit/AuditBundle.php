<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Queries\Audit\AuditTrail;
use App\Support\Reports\ReportRunner;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use ZipArchive;

/**
 * The tamper-evident export of the audit trail (3c.20, PRD 4.13): a zip an auditor can verify without Ledgerly.
 *
 * It holds the events the filters select with everything the chain hashes (the stored canonical text, exactly as
 * hashed, and `prev_hash` / `hash`), and, so that the chain stays unbroken across events that are not part of this
 * export (other companies of the organisation, events the filters left out), those events as link-only entries (id,
 * prev_hash, hash). Then the nightly seals inside the range, the chain head, a manifest with the digest of every file,
 * a README with the verification method and `verify.py`, which does it. Nothing is written to the audit tables.
 *
 * The events are checked by the same rules as the chain verification (`AuditEventVerifier`); `AuditBundleVerifier`
 * repeats that check on a finished bundle.
 */
final class AuditBundle
{
    /** Entries (events and link-only entries) of one bundle; a longer range is refused with a message. */
    public const int MAX_ENTRIES = 100_000;

    private const int CHUNK = 1000;

    public function __construct(private readonly ReportRunner $runner, private readonly AuditTrail $trail) {}

    /**
     * Builds the zip in a temporary file and returns its path; the caller deletes it.
     *
     * @param  array<string, mixed>  $filters  from, to, action, actor_id, subject_type, subject_id
     * @return array{path: string, events: int, entries: int}
     */
    public function build(string $companyId, string $companyName, array $filters, ?string $exportedBy, string $generatedAt): array
    {
        $db = $this->runner->db();
        $selected = $this->trail->ids($companyId, $filters);
        if ($selected === []) {
            throw ValidationException::withMessages(['from' => ['No audit events match these filters.']]);
        }
        $first = $selected[0];
        $last = $selected[count($selected) - 1];
        $entries = (int) $db->selectOne('SELECT COUNT(*) AS n FROM audit_events WHERE id BETWEEN ? AND ?', [$first, $last])?->n;
        if ($entries > self::MAX_ENTRIES) {
            throw ValidationException::withMessages(['from' => [sprintf(
                'These filters span %d entries of the audit chain (the chain covers every company of the organisation, so the span includes events that are not yours). One bundle holds at most %d: choose a shorter date range.',
                $entries, self::MAX_ENTRIES,
            )]]);
        }
        $isSelected = array_flip($selected);

        $dir = sys_get_temp_dir().'/ledgerly-audit-'.bin2hex(random_bytes(8));
        mkdir($dir, 0700);
        $eventsPath = $dir.'/events.jsonl';
        $out = fopen($eventsPath, 'wb') ?: throw new RuntimeException('Cannot write the bundle.');
        $after = $first - 1;
        do {
            $rows = $db->select('SELECT * FROM audit_events WHERE id > ? AND id <= ? ORDER BY id LIMIT '.self::CHUNK, [$after, $last]);
            foreach ($rows as $row) {
                $after = (int) $row->id;
                fwrite($out, json_encode($this->entry($row, isset($isSelected[$after])), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n");
            }
        } while (count($rows) === self::CHUNK);
        fclose($out);

        $seals = array_map(fn (\stdClass $s): array => [
            'sealed_through_id' => (int) $s->sealed_through_id, 'tip_hash' => (string) $s->tip_hash, 'sealed_at' => (string) $s->sealed_at,
        ], $db->select('SELECT sealed_through_id, tip_hash, sealed_at FROM audit_seals WHERE sealed_through_id BETWEEN ? AND ? ORDER BY sealed_through_id', [$first, $last]));
        file_put_contents($dir.'/seals.json', json_encode($seals, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
        copy(resource_path('audit-bundle/README.txt'), $dir.'/README.txt');
        copy(resource_path('audit-bundle/verify.py'), $dir.'/verify.py');

        $head = $db->selectOne('SELECT last_id, last_hash FROM audit_chain_heads LIMIT 1');
        $manifest = [
            'format' => 'ledgerly-audit-bundle', 'version' => 1,
            'generated_at' => $generatedAt, 'exported_by' => $exportedBy,
            'company' => ['id' => $companyId, 'name' => $companyName],
            'filters' => (object) $filters,
            'range' => ['first_id' => $first, 'last_id' => $last],
            'counts' => ['entries' => $entries, 'events' => count($selected), 'link_only' => $entries - count($selected), 'seals' => count($seals)],
            'chain_head' => $head === null || $head->last_id === null ? null : ['last_id' => (int) $head->last_id, 'last_hash' => (string) $head->last_hash],
            'includes_chain_head' => $head !== null && $head->last_id !== null && (int) $head->last_id === $last,
            'hash' => 'sha256(prev_hash || canonical), lower-case hex; canonical is RFC 8785 JSON, hashed as stored',
            'files' => [],
        ];
        foreach (['events.jsonl', 'seals.json', 'README.txt', 'verify.py'] as $name) {
            $manifest['files'][$name] = hash_file('sha256', $dir.'/'.$name);
        }
        file_put_contents($dir.'/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n");

        $zipPath = $dir.'.zip';
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Cannot write the bundle.');
        }
        foreach (['manifest.json', 'README.txt', 'events.jsonl', 'seals.json', 'verify.py'] as $name) {
            $zip->addFile($dir.'/'.$name, $name);
        }
        $zip->close();
        foreach (glob($dir.'/*') ?: [] as $f) {
            unlink($f);
        }
        rmdir($dir);

        return ['path' => $zipPath, 'events' => count($selected), 'entries' => $entries];
    }

    /** @return array<string, mixed> */
    private function entry(\stdClass $row, bool $included): array
    {
        if (! $included) {
            return ['id' => (int) $row->id, 'included' => false, 'prev_hash' => $row->prev_hash === null ? null : (string) $row->prev_hash, 'hash' => (string) $row->hash];
        }
        $doc = fn (mixed $v): mixed => $v === null ? null : json_decode((string) $v, false, 512, JSON_THROW_ON_ERROR);

        return [
            'id' => (int) $row->id, 'included' => true,
            'tenant_id' => (string) $row->tenant_id, 'company_id' => $row->company_id === null ? null : (string) $row->company_id,
            'actor_type' => (string) $row->actor_type, 'actor_id' => $row->actor_id === null ? null : (string) $row->actor_id,
            'action' => (string) $row->action,
            'subject_type' => $row->subject_type === null ? null : (string) $row->subject_type,
            'subject_id' => $row->subject_id === null ? null : (string) $row->subject_id,
            'before' => $doc($row->before), 'after' => $doc($row->after), 'context' => $doc($row->context),
            'ip' => $row->ip === null ? null : (string) $row->ip, 'user_agent' => $row->user_agent === null ? null : (string) $row->user_agent,
            'request_id' => $row->request_id === null ? null : (string) $row->request_id,
            'occurred_at' => CarbonImmutable::parse((string) $row->occurred_at)->utc()->format('Y-m-d\TH:i:s.u\Z'),
            'canonical' => (string) $row->canonical,
            'prev_hash' => $row->prev_hash === null ? null : (string) $row->prev_hash, 'hash' => (string) $row->hash,
        ];
    }
}
