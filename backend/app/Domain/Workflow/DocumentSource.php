<?php

declare(strict_types=1);

namespace App\Domain\Workflow;

/** Who created the document; workflows may apply to people, to integrations, or to both (13 §10). */
enum DocumentSource: string
{
    case User = 'user';
    case Api = 'api';
}
