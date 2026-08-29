/**
 * Ambient types for the NativeWind styling layer (spike #108).
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
