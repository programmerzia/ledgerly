/**
 * Pure helpers for the security screens: the QR image from the API's SVG, the "come back to" path kept
 * across sign-in, and password-reset link parsing. No React, no network.
 */

/**
 * The API returns the QR code as SVG markup. Markup from a response is never put in the DOM as HTML:
 * it is shown through an <img> data URI, where an SVG cannot run script or load anything. This also
 * refuses anything that is not a plain <svg> document, or that carries script, event handlers or
 * foreign content, so a changed response cannot become a detour.
 */
export function qrImageSrc(svg: string): string | null {
  const s = svg.trim();
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null;
  if (/<\s*(script|foreignObject|iframe|object|embed|image|use|a)\b/i.test(s)) return null;
  if (/\son[a-z]+\s*=/i.test(s) || /javascript:/i.test(s) || /<!(ENTITY|DOCTYPE)/i.test(s)) return null;
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** The secret in groups of four, easier to type from a screen. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

const NEXT_KEY = 'ledgerly.afterSignIn';

/** Only in-app paths: a leading slash and no protocol-relative or scheme tricks. */
export function safeNextPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return null;
  return path;
}

export function rememberNextPath(path: string, storage: Pick<Storage, 'setItem'> = sessionStorage): void {
  const safe = safeNextPath(path);
  if (safe) storage.setItem(NEXT_KEY, safe);
}

/** Returns and clears the remembered path, if any. */
export function takeNextPath(storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage): string | null {
  const path = safeNextPath(storage.getItem(NEXT_KEY));
  storage.removeItem(NEXT_KEY);
  return path;
}

/** Plain sentences for the signing PIN rules the API reports by code; anything else falls back to a general line. */
export function pinViolationText(code: string): string {
  switch (code) {
    case 'pin_format':
      return 'Use exactly six digits.';
    case 'pin_repeated':
      return 'Do not repeat one digit, like 111111.';
    case 'pin_sequential':
      return 'Do not use a run of digits, like 123456 or 654321.';
    default:
      return 'That PIN is too easy to guess.';
  }
}
