<?php

declare(strict_types=1);

namespace App\Http\Docs;

use Dedoc\Scramble\Support\Generator\OpenApi;
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
            // `waivers.*` reads as a list; it is check code → reason.
            if ($schema->type instanceof ObjectType && str_ends_with((string) $name, 'ClosePeriodRequest')) {
                $schema->type->addProperty('waivers', (new ObjectType)->additionalProperties(new StringType)
                    ->setDescription('Check code (DRAFTS, APPROVALS, FX_REVAL, BANK_REC) → the reason it is acceptable.'));
            }
        }
    }
}
