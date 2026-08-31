/**
 * Ambient types for the NativeWind styling layer (#108).
 *
 * `nativewind/types` is what teaches React Native's components to accept
 * `className` at all.
 *
 * `expo/types` is here for a less obvious reason: it carries
 * `declare module '*.css'`, without which the `global.css` side-effect import
 * in `app/_layout.tsx` fails to typecheck under TypeScript 6. Expo normally
 * supplies it through a generated `expo-env.d.ts` — but that file is
 * **gitignored**, and CI runs `npm ci` straight into `npm run typecheck` with
 * no Expo command in between to generate it. Referencing the types package
 * directly from a committed file makes the check deterministic instead of
 * dependent on whether someone has run `expo start` on that machine.
 *
 * This references the same declaration file the generated one would, rather
 * than restating it, so a machine that does have `expo-env.d.ts` sees no
 * duplicate.
 *
 * Related: `frontend/README.md` on `.expo/types/router.d.ts` going stale — the
 * same generated-file hazard, one directory over.
 */
/// <reference types="expo/types" />
/// <reference types="nativewind/types" />

/**
 * `nativewind/preset` ships an **empty** `index.d.ts`, so TypeScript resolves
 * the import and then reports `File ... is not a module` — which reads like a
 * broken install rather than a missing declaration.
 *
 * Declared here so `tailwind.config.ts` can import the preset as a value
 * instead of falling back to `require`, which the lint config forbids. The
 * shape is the only thing Tailwind asks of a preset: a partial `Config`.
 */
declare module 'nativewind/preset' {
  import type { Config } from 'tailwindcss';

  const preset: Partial<Config>;
  export default preset;
}
