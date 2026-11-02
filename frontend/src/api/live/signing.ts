/** Signing grant (ADR-0004, 13 §10). The PIN goes to the server once and is never kept by the SPA. */
import { http } from '../http';

export interface SigningGrant {
  granted: boolean;
  expiresAt: string;
}

export async function verifySigningPin(pin: string): Promise<SigningGrant> {
  const res = await http.post('/v1/signing/verify', { body: { pin } });
  return { granted: res.data.granted, expiresAt: res.data.expires_at };
}
