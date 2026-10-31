<?php

declare(strict_types=1);

/*
 * Worker for tests/Concurrency: boots the app in its own process and applies a chart template.
 * Usage: php apply-chart-template.php <tenant_id> <company_id> <user_id> <template_code>
 * Prints "applied <count>", or "refused <code>" when a business rule says no.
 */

use App\Actions\Ledger\ApplyChartTemplate;
use App\Actions\Ledger\Inputs\ApplyChartTemplateInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../../vendor/autoload.php';
$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[, $tenantId, $companyId, $userId, $template] = $argv;
$app->make(TenantContext::class)->set($tenantId);
$actor = new Actor(ActorType::User, $userId, $tenantId, $companyId);

try {
    $created = $app->make(ApplyChartTemplate::class)->handle($actor, new ApplyChartTemplateInput($companyId, $template));
    fwrite(STDOUT, "applied {$created}".PHP_EOL);
} catch (DomainRuleViolation $e) {
    fwrite(STDOUT, "refused {$e->errorCode}".PHP_EOL);
}
