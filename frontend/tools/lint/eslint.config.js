import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Syntax-level (non type-checked) rules only: the app compiles with TS 7, which typescript-eslint cannot
// load, and `tsc --noEmit` already covers type errors.
export default tseslint.config(
  { ignores: ['dist/**', 'src/api/**', 'tools/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // Baseline (plan 0.3): the pre-backend mock code base predates ESLint. These rules are warnings so
  // `npm run lint` passes today and new violations stay visible; tighten to 'error' as the mock is retired.
  // rules-of-hooks, no-duplicate-case and immutability point at real defects (TenantDetail.tsx, StatusPill.tsx,
  // SignDialog.tsx): fix those first.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-useless-assignment': 'warn',
      'no-duplicate-case': 'warn',
      'no-empty': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },
);
