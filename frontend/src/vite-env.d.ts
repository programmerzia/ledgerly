/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` (default) keeps the zustand mock; `live` talks to the Laravel API. */
  readonly VITE_API_MODE?: string;
  /** Origin of the API. Empty means same-origin (the Vite proxy or nginx forwards /api and /sanctum). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
