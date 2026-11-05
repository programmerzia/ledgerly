<?php

declare(strict_types=1);

use App\Support\Audit\AuditBundleVerifier;
use App\Support\Audit\AuditSealer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\BankingApi;
use Tests\Support\MakesApiCalls;
use Tests\Support\TamperAudit;
use Tests\Support\TradeApi;

/*
 * 3c.20: journal list, bank reconciliation report, period close checklist and the audit trail with its
 * tamper-evident bundle. Statement March: +11,000.00 (INV-1), -15.00 (bank fee), -110.00 (office supplies).
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
    $this->secondCompany();
    // A streamed export reads its rows after the request has ended; it must still see the tenant it was made for.
    $this->streamed = fn ($response): string => $response->streamedContent();
    $this->auditor = $this->person('Ada Auditor', ['Auditor']);
});

/** Finishes the March reconciliation; optionally with the bank fee excluded. @return array{id: string, fee: array<string, mixed>} */
function finishedReconciliation(object $test, bool $excludeFee = false): array
{
    return (function () use ($excludeFee): array {
        $t = $this;
        $t->sale(1000000, '2026-03-01');
        $receipt = $t->bankReceipt(1100000, '2026-03-02', 'INV-1');
        $t->importStatement()->assertCreated();
        $statement = $t->asPerson($t->owner)->getJson($t->api("bank-accounts/{$t->bank}/statements"))->json('data.0.id');
        $lines = $t->bankLines();
        $t->asPerson($t->accountant)->postJson($t->api('bank-matches'), ['statement_line_ids' => [$lines['ACME LTD payment']['id']], 'settlement_ids' => [$receipt['id']]], $t->key())->assertCreated();
        $t->asPerson($t->accountant, signing: true)->postJson($t->api("bank-statement-lines/{$lines['Office supplies']['id']}/transactions"), ['kind' => 'spend', 'account_id' => $t->f->account('5000')], $t->key())->assertCreated();
        $fee = $lines['BANK FEE MARCH'];
        if ($excludeFee) {
            $t->asPerson($t->accountant)->postJson($t->api("bank-statement-lines/{$fee['id']}/exclude"), ['version' => $fee['version'], 'reason' => 'Bank error, refunded in April'], $t->key())->assertOk();
        } else {
            $t->asPerson($t->accountant, signing: true)->postJson($t->api("bank-statement-lines/{$fee['id']}/transactions"), ['kind' => 'spend', 'account_id' => $t->f->account('6300')], $t->key())->assertCreated();
        }
        $rec = $t->asPerson($t->accountant)->postJson($t->api('bank-reconciliations'), ['statement_id' => $statement], $t->key())->assertCreated();
        $t->asPerson($t->accountant)->postJson($t->api('bank-reconciliations/'.$rec->json('data.id').'/finish'), [], $t->key())->assertOk();

        return ['id' => $rec->json('data.id'), 'fee' => $fee];
    })->call($test);
}

it('lists journals by status, source and person, with totals, lines on request, and exports them', function (): void {
    $sale = $this->sale(1000000, '2026-03-01');
    $this->asPerson($this->owner);
    $all = $this->getJson($this->api('reports/journal-list?from=2026-03-01&to=2026-03-31'))->assertOk();
    expect($all->json('data'))->not->toBeEmpty()->and($all->json('choices.sources'))->toContain('sales_invoice');
    $invoiceJournal = collect($all->json('data'))->firstWhere('source.type', 'sales_invoice');
    expect($invoiceJournal['status'])->toBe('posted')->and($invoiceJournal['debit']['amount'])->toBe($invoiceJournal['credit']['amount'])->and($invoiceJournal['debit']['amount'])->toBeGreaterThan(0)
        ->and($invoiceJournal)->not->toHaveKey('lines');

    $source = $this->getJson($this->api('reports/journal-list?source=sales_invoice'))->assertOk()->json('data');
    expect($source)->not->toBeEmpty()->and(collect($source)->pluck('source.type')->unique()->all())->toBe(['sales_invoice']);
    expect(collect($this->getJson($this->api('reports/journal-list?source=none'))->assertOk()->json('data'))->pluck('source')->filter()->all())->toBe([]);
    $this->getJson($this->api('reports/journal-list?status=draft'))->assertOk()->assertJsonCount(0, 'data');
    $this->getJson($this->api('reports/journal-list?status=bogus'))->assertUnprocessable();
    $by = fn (string $id, string $role) => collect($this->getJson($this->api("reports/journal-list?user_id={$id}&user_role={$role}"))->assertOk()->json('data'));
    $makers = $by($this->accountant->id, 'created')->merge($by($this->owner->id, 'created'));
    expect($makers->count())->toBe(count($all->json('data')))
        ->and($by($this->accountant->id, 'created')->every(fn ($j) => $j['created_by']['id'] === $this->accountant->id))->toBeTrue()
        ->and($by($this->auditor->id, 'posted')->all())->toBe([]);

    $withLines = $this->getJson($this->api('reports/journal-list?source=sales_invoice&include_lines=true'))->assertOk()->json('data.0');
    expect($withLines['lines'])->not->toBeEmpty()->and(array_sum(array_map(fn ($l) => $l['debit']['amount'], $withLines['lines'])))->toBe($withLines['debit']['amount']);

    $csv = ($this->streamed)($this->get($this->api('reports/journal-list/export?source=sales_invoice&include_lines=true&format=csv'))->assertOk());
    expect($csv)->toContain('Journal list')->and($csv)->toContain('Created by')->and($csv)->toContain('JV-')->and($csv)->toContain('11000.00');
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'report.exported')->count())->toBe(1));
    expect($sale)->not->toBeEmpty();
});

it('filters the journal list by period', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->asPerson($this->owner);
    $period = $this->inTenant(fn () => DB::table('fiscal_periods')->where('company_id', $this->f->companyId)->where('starts_on', '<=', '2026-03-15')->where('ends_on', '>=', '2026-03-15')->where('kind', 'regular')->value('id'));
    expect($this->getJson($this->api("reports/journal-list?period_id={$period}"))->assertOk()->json('data'))->not->toBeEmpty();
    $feb = $this->inTenant(fn () => DB::table('fiscal_periods')->where('company_id', $this->f->companyId)->where('starts_on', '<=', '2026-02-15')->where('ends_on', '>=', '2026-02-15')->where('kind', 'regular')->value('id'));
    $this->getJson($this->api("reports/journal-list?period_id={$feb}"))->assertOk()->assertJsonCount(0, 'data');
});

it('reports a finished bank reconciliation: proof, statement against books, nothing unmatched', function (): void {
    $done = finishedReconciliation($this);
    $this->asPerson($this->accountant);
    $r = $this->getJson($this->api("bank-reconciliations/{$done['id']}/report"))->assertOk()->json('data');

    expect($r['statement']['opening_balance']['amount'])->toBe(0)->and($r['statement']['receipts']['amount'])->toBe(1100000)->and($r['statement']['payments']['amount'])->toBe(-12500)
        ->and($r['statement']['closing_balance']['amount'])->toBe(1087500)->and($r['book']['balance']['amount'])->toBe(1087500)
        ->and($r['checks']['statement_foots'])->toBeTrue()->and($r['checks']['steps_add_up'])->toBeTrue()->and($r['checks']['difference_is_zero'])->toBeTrue()
        ->and($r['checks']['opening_continuity']['agrees'])->toBeNull()
        ->and(collect($r['steps'])->pluck('amount.amount', 'key')->all())->toBe([
            'statement_closing' => 1087500, 'book_balance' => 1087500, 'less_unmatched_book' => 0, 'add_unmatched_statement' => 0, 'add_late' => 0, 'adjusted_book_balance' => 1087500, 'difference' => 0,
        ])
        ->and($r['unmatched_book_items']['items'])->toBe([])->and($r['excluded_lines']['count'])->toBe(0)->and($r['matched']['count'])->toBe(3)
        ->and($r['reconciliation']['finished_by']['name'])->toBe($this->accountant->name);

    // The frozen report is what is shown: it is the stored snapshot, not a new calculation.
    $stored = $this->inTenant(fn () => json_decode((string) DB::table('bank_reconciliations')->where('id', $done['id'])->value('report'), true));
    expect($r['book']['balance']['amount'])->toBe($stored['book']['balance'])->and($r['steps'][5]['amount']['amount'])->toBe($stored['adjusted_book_balance']);
});

it('lists excluded statement lines with their reason, and keeps them in the proof', function (): void {
    $done = finishedReconciliation($this, excludeFee: true);
    $this->asPerson($this->accountant);
    $r = $this->getJson($this->api("bank-reconciliations/{$done['id']}/report"))->assertOk()->json('data');

    expect($r['excluded_lines']['count'])->toBe(1)->and($r['excluded_lines']['total']['amount'])->toBe(-1500)->and($r['excluded_lines']['list_agrees'])->toBeTrue()
        ->and($r['excluded_lines']['items'][0]['reason'])->toBe('Bank error, refunded in April')->and($r['excluded_lines']['items'][0]['excluded_by'])->toBe($this->accountant->name)
        ->and($r['checks']['difference_is_zero'])->toBeTrue()
        ->and(collect($r['steps'])->firstWhere('key', 'add_unmatched_statement')['of_which_excluded']['amount'])->toBe(-1500);

    $csv = ($this->streamed)($this->get($this->api("reports/bank-reconciliation/export?reconciliation_id={$done['id']}&format=csv"))->assertOk());
    expect($csv)->toContain('Bank error, refunded in April')->and($csv)->toContain('Difference is zero');
});

it('refuses a reconciliation that is not finished or not the company\'s, and one the role may not see', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->importStatement()->assertCreated();
    $statement = $this->asPerson($this->owner)->getJson($this->api("bank-accounts/{$this->bank}/statements"))->json('data.0.id');
    $rec = $this->asPerson($this->accountant)->postJson($this->api('bank-reconciliations'), ['statement_id' => $statement], $this->key())->assertCreated();

    $this->getJson($this->api('bank-reconciliations/'.$rec->json('data.id').'/report'))->assertUnprocessable()->assertJsonValidationErrors('reconciliation_id');
    $this->get($this->api('reports/bank-reconciliation/export?reconciliation_id='.$rec->json('data.id').'&format=csv'))->assertUnprocessable();
    $this->get($this->api('reports/bank-reconciliation/export?format=csv'))->assertUnprocessable();
    $this->get($this->api('reports/bank-reconciliation/export?reconciliation_id='.(string) Str::uuid7().'&format=csv'))->assertNotFound();
});

it('exports the period close checklist, live and as recorded', function (): void {
    $period = $this->inTenant(fn () => DB::table('fiscal_periods')->where('company_id', $this->f->companyId)->where('starts_on', '<=', '2026-03-15')->where('ends_on', '>=', '2026-03-15')->where('kind', 'regular')->value('id'));
    $this->asPerson($this->owner);
    $live = $this->getJson($this->api("reports/period-close?period_id={$period}"))->assertOk()->json('data');
    expect($live['source'])->toBe('live')->and(collect($live['checks'])->pluck('code')->all())->toContain('DRAFTS');
    $csv = ($this->streamed)($this->get($this->api("reports/period-close/export?period_id={$period}&format=csv"))->assertOk());
    expect($csv)->toContain('Period close checklist')->and($csv)->toContain('as it stands now');
    $this->getJson($this->api('reports/period-close'))->assertUnprocessable();
});

it('filters and exports the audit trail', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->asPerson($this->auditor);
    $today = (string) $this->inTenant(fn () => substr((string) DB::table('audit_events')->max('occurred_at'), 0, 10));
    $all = $this->getJson($this->api("audit-events?from={$today}&to={$today}"))->assertOk()->json('data');
    expect($all)->not->toBeEmpty();
    $this->getJson($this->api('audit-events?from=2000-01-01&to=2000-01-02'))->assertOk()->assertJsonCount(0, 'data');
    $this->getJson($this->api('audit-events?from=2026-03-02&to=2026-03-01'))->assertUnprocessable();

    $csv = ($this->streamed)($this->get($this->api("reports/audit-trail/export?from={$today}&to={$today}&action=invoice&format=csv"))->assertOk());
    expect($csv)->toContain('Audit trail')->and($csv)->toContain('invoice.');
    // A person with reports.export but without the audit log is refused.
    $this->asPerson($this->accountant);
    $this->get($this->api("reports/audit-trail/export?from={$today}&to={$today}&format=csv"))->assertForbidden();
});

/** The bundle zip's bytes, copied out before the response deletes the file. */
function bundleOf(object $test, string $query = ''): string
{
    $response = (fn () => $this->get($this->api('reports/audit-trail/bundle'.$query)))->call($test)->assertOk();
    $path = $response->baseResponse->getFile()->getPathname();
    $copy = tempnam(sys_get_temp_dir(), 'bundle-test-').'.zip';
    copy($path, $copy);

    return $copy;
}

/** Rewrites events.jsonl of a bundle through a callback on its lines. */
function rewriteEvents(string $zip, Closure $edit): string
{
    $z = new ZipArchive;
    $z->open($zip);
    $lines = preg_split('/\R/', (string) $z->getFromName('events.jsonl'), -1, PREG_SPLIT_NO_EMPTY);
    $z->addFromString('events.jsonl', implode("\n", $edit($lines))."\n");
    $z->close();

    return $zip;
}

it('exports a tamper-evident audit bundle that verifies, and says what it holds', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->inTenant(fn () => app(AuditSealer::class)->seal());
    $this->asPerson($this->auditor, signing: true);
    $day = (string) $this->inTenant(fn () => substr((string) DB::table('audit_events')->max('occurred_at'), 0, 10));
    $zip = bundleOf($this, '?from='.$day.'&to='.$day);

    $z = new ZipArchive;
    $z->open($zip);
    $manifest = json_decode((string) $z->getFromName('manifest.json'), true);
    $readme = (string) $z->getFromName('README.txt');
    expect($z->locateName('verify.py'))->not->toBeFalse()->and($readme)->toContain('SHA-256( prev_hash || canonical )')->and($readme)->toContain('HOW TO VERIFY')
        ->and($manifest['counts']['events'])->toBeGreaterThan(0)->and($manifest['counts']['seals'])->toBe(1)
        ->and($manifest['company']['id'])->toBe($this->f->companyId)->and($manifest['files'])->toHaveKeys(['events.jsonl', 'seals.json', 'README.txt', 'verify.py']);
    $entries = array_map(fn ($l) => json_decode($l, true), preg_split('/\R/', (string) $z->getFromName('events.jsonl'), -1, PREG_SPLIT_NO_EMPTY));
    $z->close();
    // Events of other companies or without one stay in the chain as hashes only.
    expect(collect($entries)->where('included', false)->every(fn ($e) => array_keys($e) === ['id', 'included', 'prev_hash', 'hash']))->toBeTrue()
        ->and(collect($entries)->where('included', true)->every(fn ($e) => $e['company_id'] === $this->f->companyId))->toBeTrue();

    expect((new AuditBundleVerifier)->verify($zip))->toBe([]);
    $this->inTenant(fn () => expect(DB::table('audit_events')->where('action', 'report.exported')->count())->toBe(1));
    unlink($zip);
});

it('fails verification for every kind of tampering with the bundle', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->inTenant(fn () => app(AuditSealer::class)->seal());
    $this->asPerson($this->auditor, signing: true);
    $original = bundleOf($this);
    $verify = new AuditBundleVerifier;
    $full = fn (array $lines): array => array_keys(array_filter($lines, fn ($l) => json_decode($l, true)['included']));
    $copy = function () use ($original): string {
        $c = tempnam(sys_get_temp_dir(), 'bundle-tamper-').'.zip';
        copy($original, $c);

        return $c;
    };
    expect($verify->verify($original))->toBe([]);

    // 1. A column edited, canonical text untouched.
    $a = rewriteEvents($copy(), function (array $lines) use ($full) {
        $i = $full($lines)[1];
        $e = json_decode($lines[$i], true);
        $e['action'] = 'invoice.forged';
        $lines[$i] = json_encode($e);

        return $lines;
    });
    expect(implode(' ', $verify->verify($a)))->toContain('column action differs');

    // 2. The canonical text edited, hash untouched.
    $b = rewriteEvents($copy(), function (array $lines) use ($full) {
        $i = $full($lines)[1];
        $e = json_decode($lines[$i], true);
        $e['canonical'] = str_replace('"action"', '"action" ', $e['canonical']);
        $lines[$i] = json_encode($e);

        return $lines;
    });
    expect(implode(' ', $verify->verify($b)))->toContain('hash does not match');

    // 3. An event removed from the middle breaks the link.
    $c = rewriteEvents($copy(), function (array $lines) {
        array_splice($lines, 2, 1);

        return $lines;
    });
    expect(implode(' ', $verify->verify($c)))->toContain('prev_hash does not match');

    // 4. A link-only entry's hash edited breaks the link after it.
    $d = rewriteEvents($copy(), function (array $lines) {
        foreach ($lines as $i => $l) {
            $e = json_decode($l, true);
            if ($e['included'] === false && isset($lines[$i + 1])) {
                $e['hash'] = str_repeat('a', 64);
                $lines[$i] = json_encode($e);

                return $lines;
            }
        }

        return $lines;
    });
    expect($verify->verify($d))->not->toBe([]);

    // 5. Any file edited after the manifest was written.
    $z = new ZipArchive;
    $z->open($e = $copy());
    $z->addFromString('README.txt', 'nothing to see');
    $z->close();
    expect(implode(' ', $verify->verify($e)))->toContain('README.txt differs');

    // 6. A seal that no longer matches.
    $z->open($f = $copy());
    $seals = json_decode((string) $z->getFromName('seals.json'), true);
    $seals[0]['tip_hash'] = str_repeat('b', 64);
    $z->addFromString('seals.json', json_encode($seals));
    $z->close();
    expect(implode(' ', $verify->verify($f)))->toContain('seal through');

    foreach ([$original, $a, $b, $c, $d, $e, $f] as $path) {
        unlink($path);
    }
});

it('fails a bundle exported after a row in the audit table was edited', function (): void {
    $this->sale(1000000, '2026-03-01');
    $victim = $this->inTenant(fn () => (int) DB::table('audit_events')->where('company_id', $this->f->companyId)->orderByDesc('id')->value('id'));
    TamperAudit::as($this->f->tenantId, fn ($owner) => $owner->update("UPDATE audit_events SET after = '{\"forged\": true}'::jsonb WHERE id = ?", [$victim]));
    $this->asPerson($this->auditor, signing: true);
    $zip = bundleOf($this);

    expect(implode(' ', (new AuditBundleVerifier)->verify($zip)))->toContain("event {$victim}: column after differs");
    unlink($zip);
});

it('checks the bundle with verify.py, the way a third party would', function (): void {
    $python = trim((string) shell_exec('command -v python3'));
    if ($python === '') {
        $this->markTestSkipped('python3 is not installed.');
    }
    $this->sale(1000000, '2026-03-01');
    $this->inTenant(fn () => app(AuditSealer::class)->seal());
    $this->asPerson($this->auditor, signing: true);
    $zip = bundleOf($this);
    $dir = sys_get_temp_dir().'/bundle-py-'.bin2hex(random_bytes(4));
    mkdir($dir);
    $z = new ZipArchive;
    $z->open($zip);
    $z->extractTo($dir);
    $z->close();

    exec($python.' '.escapeshellarg($dir.'/verify.py').' '.escapeshellarg($zip).' 2>&1', $out, $status);
    expect($status)->toBe(0)->and(implode("\n", $out))->toContain('OK: every check passed');

    // The same bundle with one column changed fails.
    rewriteEvents($zip, function (array $lines) {
        foreach ($lines as $i => $l) {
            $e = json_decode($l, true);
            if ($e['included']) {
                $e['actor_type'] = 'forged-actor';
                $lines[$i] = json_encode($e);
                break;
            }
        }

        return $lines;
    });
    exec($python.' '.escapeshellarg($dir.'/verify.py').' '.escapeshellarg($zip).' 2>&1', $out2, $status2);
    expect($status2)->toBe(1)->and(implode("\n", $out2))->toContain('FAIL');

    foreach (glob($dir.'/*') ?: [] as $file) {
        unlink($file);
    }
    rmdir($dir);
    unlink($zip);
});

it('keeps the bundle to people with the audit log, the export permission and the signing PIN', function (): void {
    $this->sale(1000000, '2026-03-01');
    $this->asPerson($this->auditor);   // no signing grant
    $this->get($this->api('reports/audit-trail/bundle'))->assertForbidden()->assertJsonPath('code', 'signature_required');
    $this->asPerson($this->accountant, signing: true);   // signed, but no audit.view
    $this->get($this->api('reports/audit-trail/bundle'))->assertForbidden();
    $this->asPerson($this->auditor, signing: true);
    $this->get($this->api('reports/audit-trail/bundle?from=2000-01-01&to=2000-01-02'))->assertUnprocessable();   // no events: a clear message
});
