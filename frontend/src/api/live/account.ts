/**
 * Live account security calls: password reset, two-factor enrolment (Fortify under /v1/auth) and the
 * signing PIN (/v1/signing). Fortify's two-factor endpoints need a recently confirmed password; when it
 * is not, the API answers 423 and the caller asks for the password (`needsPasswordConfirmation`).
 */
import { http } from '../http';
import { ApiError } from '../errors';

export async function requestPasswordReset(email: string): Promise<void> {
  await http.post('/v1/auth/forgot-password', { body: { email } });
}

export interface ResetPasswordInput {
  token: string;
  email: string;
  password: string;
  password_confirmation: string;
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await http.post('/v1/auth/reset-password', { body: input });
}

export function needsPasswordConfirmation(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'password_confirmation_required';
}

export async function confirmPassword(password: string): Promise<void> {
  await http.post('/v1/auth/user/confirm-password', { body: { password } });
}

export async function enableTwoFactor(): Promise<void> {
  await http.post('/v1/auth/user/two-factor-authentication', { body: {} });
}

export interface TwoFactorSetup {
  /** Raw SVG markup from the API. Never inject it into the page; use `qrImageSrc`. */
  svg: string;
  /** otpauth:// URL, for authenticator apps that take a link. */
  url: string;
  secretKey: string;
}

export async function fetchTwoFactorSetup(): Promise<TwoFactorSetup> {
  const [qr, secret] = await Promise.all([http.get('/v1/auth/user/two-factor-qr-code'), http.get('/v1/auth/user/two-factor-secret-key')]);
  const q = qr as { svg?: string; url?: string };
  return { svg: q.svg ?? '', url: q.url ?? '', secretKey: String((secret as { secretKey?: unknown }).secretKey ?? '') };
}

export async function confirmTwoFactor(code: string): Promise<void> {
  await http.post('/v1/auth/user/confirmed-two-factor-authentication', { body: { code } });
}

export async function fetchRecoveryCodes(): Promise<string[]> {
  const codes = (await http.get('/v1/auth/user/two-factor-recovery-codes')) as unknown;
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
}

export async function regenerateRecoveryCodes(): Promise<void> {
  await http.post('/v1/auth/user/two-factor-recovery-codes');
}

export async function disableTwoFactor(): Promise<void> {
  await http.delete('/v1/auth/user/two-factor-authentication');
}

export async function setSigningPin(input: { current_password: string; pin: string }): Promise<void> {
  await http.put('/v1/signing/pin', { body: input });
}
