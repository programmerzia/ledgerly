<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use LogicException;

/** An Action acquired locks out of the global order (13 §8). A bug, never a user error. */
final class LockOrderViolation extends LogicException {}
