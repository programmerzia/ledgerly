<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use LogicException;

final class NoTenantContext extends LogicException {}
