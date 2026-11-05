<?php

declare(strict_types=1);

namespace App\Support\Problem;

/** Domain error code → HTTP status (13 §5, §16). Unlisted domain codes are 422. */
final class StatusMap
{
    private const array MAP = [
        'version_conflict' => 409,
        'idempotency_in_progress' => 409,
        'idempotency_key_reuse' => 422,
        'idempotency_key_required' => 428,
        'idempotency_key_invalid' => 400,
        'forbidden' => 403,
        'match_override_forbidden' => 403,
        'match_override_self_forbidden' => 403,
        'credit_limit_override_forbidden' => 403,
        'credit_limit_override_self_forbidden' => 403,
        'not_found' => 404,
        'self_approval_forbidden' => 403,
        'approver_role_required' => 403,
        'approver_already_signed' => 403,
        'document_not_submittable' => 409,
        'document_not_pending' => 409,
        'document_not_voidable' => 409,
        'document_type_unknown' => 404,
        'signature_required' => 403,
        'two_factor_required' => 403,
        'signing_locked' => 423,
        'signing_failed' => 403,
        'signing_pin_not_set' => 409,
        'tenant_read_only' => 423,
        'password_confirmation_required' => 423,
        'unauthenticated' => 401,
        'tenant_required' => 409,
        'tenant_access_denied' => 403,
        'tenant_unavailable' => 403,
        'company_access_denied' => 403,
        'company_not_found' => 404,
        'email_taken' => 409,
        'already_member' => 409,
        'invitation_not_found' => 404,
        'invitation_already_accepted' => 409,
        'invitation_revoked' => 410,
        'invitation_expired' => 410,
        'invitation_email_mismatch' => 403,
        'sign_in_required' => 409,
        'membership_disabled' => 403,
        'entitlement_exceeded' => 402,
        'rate_limited' => 429,
        'fx_provider_unavailable' => 502,
        'upload_too_large' => 413,
        'import_state_invalid' => 409,
        'import_purged' => 409,
        'import_too_large' => 413,
        'attachment_immutable' => 409,
        'attachment_mismatch' => 409,
        'attachment_not_uploaded' => 409,
    ];

    public static function status(string $code): int
    {
        return self::MAP[$code] ?? 422;
    }
}
