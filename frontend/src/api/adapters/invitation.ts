/** Invitation link states (02_AppFlow §2): what the page should offer, from the preview plus who is signed in. */
import type { ApiInvitationPreview } from '../live/team';

export type InvitationView =
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'accepted' }
  | { kind: 'create_account' }
  | { kind: 'sign_in' }
  | { kind: 'accept_signed_in' }
  | { kind: 'wrong_user'; signedInAs: string };

/** `signedInEmail` is the current session's email, or null when nobody is signed in. */
export function invitationView(preview: ApiInvitationPreview, signedInEmail: string | null): InvitationView {
  if (preview.status === 'expired') return { kind: 'expired' };
  if (preview.status === 'revoked') return { kind: 'revoked' };
  if (preview.status === 'accepted') return { kind: 'accepted' };
  if (signedInEmail !== null) {
    return signedInEmail.toLowerCase() === preview.email.toLowerCase() ? { kind: 'accept_signed_in' } : { kind: 'wrong_user', signedInAs: signedInEmail };
  }
  return preview.account_exists ? { kind: 'sign_in' } : { kind: 'create_account' };
}

/** Codes a failed accept can come back with, each mapped to the view the page should fall to. */
export function viewForAcceptError(code: string, signedInEmail: string | null): InvitationView | null {
  switch (code) {
    case 'invitation_expired':
      return { kind: 'expired' };
    case 'invitation_revoked':
      return { kind: 'revoked' };
    case 'invitation_already_accepted':
      return { kind: 'accepted' };
    case 'sign_in_required':
      return { kind: 'sign_in' };
    case 'invitation_email_mismatch':
      return { kind: 'wrong_user', signedInAs: signedInEmail ?? '' };
    default:
      return null;
  }
}
