import { API_MODE, type ApiMode } from '@/api/config';

/** The one place a mode picks an implementation. Both are plain hooks/functions with the same signature. */
export function selectByMode<T>(impl: { mock: T; live: T }, mode: ApiMode = API_MODE): T {
  return mode === 'live' ? impl.live : impl.mock;
}
