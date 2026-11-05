/** Settings → General: the look of documents (accent, footer, payment instructions, logo) and the email templates (3c.4, 3c.5). */
import type { components } from '../schema';

export const EMAIL_FAMILIES: { key: string; label: string }[] = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'credit_note', label: 'Credit note' },
  { key: 'statement', label: 'Statement' },
  { key: 'payment_advice', label: 'Payment advice' },
];

export interface LookForm {
  accent_color: string;
  footer_text: string;
  payment_instructions: string;
  email: Record<string, { subject: string; body: string }>;
}

type SettingsWithLook = Pick<components['schemas']['CompanySettingsResource'], 'document_look' | 'email_templates'>;

export function toLookForm(s: SettingsWithLook): LookForm {
  return {
    accent_color: s.document_look.accent_color,
    footer_text: s.document_look.footer_text,
    payment_instructions: s.document_look.payment_instructions,
    email: Object.fromEntries(EMAIL_FAMILIES.map((f) => [f.key, { subject: s.email_templates[f.key]?.subject ?? '', body: s.email_templates[f.key]?.body ?? '' }])),
  };
}

export interface LookPatch {
  accent_color?: string;
  footer_text?: string;
  payment_instructions?: string;
  email_templates?: Record<string, { subject: string; body: string }>;
}

/** Only what changed, so a stale tab cannot overwrite what another person saved in a field it did not touch. */
export function lookPatch(saved: LookForm, next: LookForm): LookPatch {
  const patch: LookPatch = {};
  if (next.accent_color.toUpperCase() !== saved.accent_color.toUpperCase()) patch.accent_color = next.accent_color;
  if (next.footer_text !== saved.footer_text) patch.footer_text = next.footer_text;
  if (next.payment_instructions !== saved.payment_instructions) patch.payment_instructions = next.payment_instructions;
  for (const { key } of EMAIL_FAMILIES) {
    const a = saved.email[key];
    const b = next.email[key];
    if (a && b && (a.subject !== b.subject || a.body !== b.body)) (patch.email_templates ??= {})[key] = { subject: b.subject, body: b.body };
  }
  return patch;
}

export const isHexColor = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v);

/** Placeholders written as `{{ name }}` that are not on the allowed list (the server refuses them too). */
export function unknownPlaceholders(text: string, allowed: string[]): string[] {
  const found = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1] ?? '');
  return [...new Set(found.filter((n) => !allowed.includes(n)))];
}

export const LOGO_TYPES = ['image/png', 'image/jpeg'];
export const LOGO_MAX_BYTES = 512 * 1024;

/** A problem with a logo file before it is sent; null when it looks fine (the server checks the bytes). */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'The logo must be a PNG or JPEG image.';
  if (file.size > LOGO_MAX_BYTES) return 'The logo must be 512 KB or smaller.';
  return null;
}
