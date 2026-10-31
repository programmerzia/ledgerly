<?php

declare(strict_types=1);

namespace App\Support;

enum ActorType: string
{
    case User = 'user';
    case ApiClient = 'api_client';
    case System = 'system';
    case AdminImpersonating = 'admin_impersonating';
}
