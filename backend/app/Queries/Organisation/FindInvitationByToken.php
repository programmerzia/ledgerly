<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use Illuminate\Support\Facades\DB;

/**
 * Locates an invitation from its raw token before any tenant is known, through the sysops
 * function (13 §6). Returns ids only; read the row under the tenant's context.
 */
final class FindInvitationByToken
{
    /** @return array{invitation_id: string, tenant_id: string}|null */
    public function __invoke(string $token): ?array
    {
        if ($token === '' || strlen($token) > 128) {
            return null;
        }
        $row = DB::selectOne('SELECT invitation_id, tenant_id FROM sysops.invitation_by_token_hash(?)', [hash('sha256', $token)]);

        return $row === null ? null : ['invitation_id' => (string) $row->invitation_id, 'tenant_id' => (string) $row->tenant_id];
    }
}
