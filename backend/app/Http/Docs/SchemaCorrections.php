<?php

declare(strict_types=1);

namespace App\Http\Docs;

use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Types\ArrayType;
use Dedoc\Scramble\Support\Generator\Types\BooleanType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;

/** Shapes Scramble cannot infer, corrected so the generated client types tell the truth. */
final class SchemaCorrections
{
    public function __invoke(OpenApi $openApi): void
    {
        foreach ($openApi->components->schemas as $name => $schema) {
            // `can` comes from Json::can(): named booleans, which Scramble reads as a plain array.
            if ($schema->type instanceof ObjectType && $schema->type->hasProperty('can')) {
                $schema->type->addProperty('can', (new ObjectType)->additionalProperties(new BooleanType));
            }
            // `lines.*.dimensions` reads as a list; it is dimension id → value id.
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'JournalRequest') && $schema->type->hasProperty('lines')
                || $schema->type instanceof ObjectType && preg_match('/(?<![A-Za-z])(RequisitionRequest|PurchaseOrderRequest|RevisionRequest)$/', (string) $name) === 1 && $schema->type->hasProperty('lines')) {
                $lines = $schema->type->getProperty('lines');
                if ($lines instanceof ArrayType && $lines->items instanceof ObjectType) {
                    $lines->items->addProperty('dimensions', (new ObjectType)->additionalProperties(new StringType));
                }
            }
            // These are objects too: column mapping, and dimension id → value id on bank lines and rules.
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'ImportStatementRequest') && $schema->type->hasProperty('mapping')) {
                $schema->type->addProperty('mapping', (new ObjectType)->additionalProperties(new StringType));
            }
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'BankTransactionRequest') && $schema->type->hasProperty('dimensions')) {
                $schema->type->addProperty('dimensions', (new ObjectType)->additionalProperties(new StringType));
            }
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'BankRuleRequest') && $schema->type->hasProperty('action')) {
                $action = $schema->type->getProperty('action');
                if ($action instanceof ObjectType && $action->hasProperty('dimensions')) {
                    $action->addProperty('dimensions', (new ObjectType)->additionalProperties(new StringType));
                }
            }
            // Rules differ by route: /bills takes the purchase kinds, recurring documents their own types.
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'InvoiceRequest') && $schema->type->hasProperty('kind')) {
                $schema->type->addProperty('kind', (new StringType)->enum(['sales_invoice', 'credit_note', 'purchase_bill', 'debit_note']));
            }
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'RecurringScheduleResource') && $schema->type->hasProperty('document_type')) {
                $schema->type->addProperty('document_type', (new StringType)->enum(['journal', 'invoice', 'bill']));
            }
            // `waivers.*` reads as a list; it is check code → reason.
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'ClosePeriodRequest')) {
                $schema->type->addProperty('waivers', (new ObjectType)->additionalProperties(new StringType)
                    ->setDescription('Check code (DRAFTS, APPROVALS, FX_REVAL, DEPR_RUN, BANK_REC) → the reason it is acceptable.'));
            }
        }
    }
}
