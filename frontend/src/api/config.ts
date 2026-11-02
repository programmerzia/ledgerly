/** Build-time switch between the zustand mock and the Laravel API (docs/15_Frontend_Integration.md). */
export type ApiMode = 'mock' | 'live';

export function resolveApiMode(raw: unknown): ApiMode {
  return raw === 'live' ? 'live' : 'mock';
}

export const API_MODE: ApiMode = resolveApiMode(import.meta.env.VITE_API_MODE);
export const IS_LIVE = API_MODE === 'live';

/** Empty string = same origin, which is what cookies need (ADR-0006). */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
