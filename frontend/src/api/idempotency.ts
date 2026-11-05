/**
 * One Idempotency-Key per user intent (13 §11). An intent is "the user pressed Post on this form".
 * Retrying that intent (network blip, 419 refresh, "Try again" after a 5xx) reuses the key; the next
 * intent gets a new one. Keys are only ever sent on mutating requests.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isMutating = (method: string): boolean => MUTATING_METHODS.has(method.toUpperCase());

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  // randomUUID exists only in secure contexts (https or localhost); plain http on an address needs the long way round.
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A handle for one intent. Pass the same handle to every attempt; call `settle()` when it succeeded. */
export interface Intent {
  /** The key for the current attempt series. Stable until `settle()`. */
  readonly key: string;
  /** Marks the intent finished, so the next call to `intent()` is a new one. */
  settle(): void;
}

export function createIntent(factory: () => string = newIdempotencyKey): Intent {
  let key = factory();
  return {
    get key() {
      return key;
    },
    settle() {
      key = factory();
    },
  };
}
