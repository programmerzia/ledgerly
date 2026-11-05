<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Domain\Audit\AuditEventVerifier;
use ZipArchive;

/**
 * Checks an audit evidence bundle the way its README describes (and `verify.py` does), using the same per-event
 * rules as the chain verification (`AuditEventVerifier`). Reads the zip only; nothing is written anywhere.
 */
final class AuditBundleVerifier
{
    /** @return list<string> the problems found; empty means the bundle verifies */
    public function verify(string $zipPath): array
    {
        $zip = new ZipArchive;
        if ($zip->open($zipPath) !== true) {
            return ['The file is not a zip.'];
        }
        $files = [];
        foreach (['manifest.json', 'events.jsonl', 'seals.json', 'README.txt', 'verify.py'] as $name) {
            $content = $zip->getFromName($name);
            if ($content !== false) {
                $files[$name] = $content;
            }
        }
        $zip->close();
        foreach (['manifest.json', 'events.jsonl', 'seals.json'] as $required) {
            if (! isset($files[$required])) {
                return ["{$required} is missing."];
            }
        }

        $problems = [];
        /** @var array<string, mixed> $manifest */
        $manifest = json_decode($files['manifest.json'], true, 512, JSON_THROW_ON_ERROR);
        foreach ((array) ($manifest['files'] ?? []) as $name => $digest) {
            if (isset($files[(string) $name]) && ! hash_equals((string) $digest, hash('sha256', $files[(string) $name]))) {
                $problems[] = "{$name} differs from the digest in manifest.json.";
            }
        }

        /** @var array<int, array<string, mixed>> $byId */
        $byId = [];
        $previous = null;
        foreach (preg_split('/\R/', $files['events.jsonl'], -1, PREG_SPLIT_NO_EMPTY) ?: [] as $line) {
            /** @var array<string, mixed> $e */
            $e = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
            $id = (int) $e['id'];
            $byId[$id] = $e;
            if ($previous !== null) {
                if ($e['prev_hash'] !== $previous['hash']) {
                    $problems[] = "event {$id}: prev_hash does not match the hash of event {$previous['id']}.";
                }
                if ($id <= (int) $previous['id']) {
                    $problems[] = "event {$id}: ids are not increasing.";
                }
            }
            if (($e['included'] ?? false) === true) {
                // The bundle holds documents decoded to arrays; the verifier wants the row's raw JSON text, as the database gives it.
                $row = $e;
                foreach (AuditEventVerifier::DOCUMENTS as $doc) {
                    $row[$doc] = $e[$doc] === null ? null : json_encode($e[$doc], JSON_THROW_ON_ERROR);
                }
                if (! AuditEventVerifier::hashMatches($row, $e['prev_hash'] === null ? null : (string) $e['prev_hash'])) {
                    $problems[] = "event {$id}: hash does not match sha256(prev_hash + canonical).";
                }
                $column = AuditEventVerifier::columnMismatch($row);
                if ($column !== null) {
                    $problems[] = "event {$id}: column {$column} differs from the canonical record.";
                }
            }
            $previous = $e;
        }

        /** @var list<array<string, mixed>> $seals */
        $seals = json_decode($files['seals.json'], true, 512, JSON_THROW_ON_ERROR);
        foreach ($seals as $seal) {
            $sealed = $byId[(int) $seal['sealed_through_id']] ?? null;
            if ($sealed === null) {
                $problems[] = "seal through {$seal['sealed_through_id']}: that event is not in the bundle.";
            } elseif ($sealed['hash'] !== $seal['tip_hash']) {
                $problems[] = "seal through {$seal['sealed_through_id']}: the event hash differs from the sealed tip.";
            }
        }

        $head = $manifest['chain_head'] ?? null;
        if (is_array($head) && ($manifest['includes_chain_head'] ?? false) === true && $previous !== null
            && ((int) $previous['id'] !== (int) $head['last_id'] || $previous['hash'] !== $head['last_hash'])) {
            $problems[] = 'the last event is not the chain head recorded in manifest.json.';
        }

        return $problems;
    }
}
