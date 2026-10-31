<?php

declare(strict_types=1);

/*
 * Worker for tests/Concurrency: boots the app in its own process and posts journals.
 * Usage: php post-journals.php <tenant_id> <company_id> <user_id> <cash_id> <sales_id> <count>
 */

use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../../vendor/autoload.php';
$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[, $tenantId, $companyId, $userId, $cash, $sales, $count] = $argv;
$app->make(TenantContext::class)->set($tenantId);
$actor = new Actor(ActorType::User, $userId, $tenantId, $companyId);

for ($i = 1; $i <= (int) $count; $i++) {
    $draft = $app->make(CreateJournalDraft::class)->handle($actor, new JournalDraftInput(
        $companyId, JournalType::Manual, new DateTimeImmutable('2026-03-15'),
        [new DraftLine($cash, debit: $i), new DraftLine($sales, credit: $i)],
    ));
    $posted = $app->make(PostJournal::class)->handle($actor, new PostJournalInput($draft->id));
    fwrite(STDOUT, $posted->number.PHP_EOL);
}
