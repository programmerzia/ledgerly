<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use RuntimeException;

/**
 * Thrown inside a UnitOfWork when a re-check after locking shows that the unlocked read was stale
 * (13 §8 "read unlocked, lock in order, then re-check"). The UnitOfWork rolls back and retries.
 */
final class RetryUnitOfWork extends RuntimeException {}
