<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * UUIDv7 string keys, assigned by Actions through IdGenerator (13 §8). Models carry relations,
 * casts and scopes only; writes happen in Actions with explicitly mapped attributes.
 */
abstract class BaseModel extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];
}
