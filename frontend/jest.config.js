const { transformIgnorePatterns } = require('jest-expo/jest-preset');

/**
 * Moved out of `package.json` so `transformIgnorePatterns` can be *derived*
 * from the preset rather than restated.
 *
 * **`@rn-primitives/*` ships untranspiled JSX.** `dist/index.js` contains a
 * literal `return <>…`, and its `.mjs` is no different — so jest, which does
 * not transform `node_modules` by default, fails the whole suite with
 * `SyntaxError: Unexpected token '<'` pointing inside the package. Metro
 * transforms it happily, which is why this only appears under test.
 *
 * jest-expo's first pattern is a negative lookahead listing the packages that
 * *are* transformed. The array cannot express "also allow this one" additively
 * — a file is ignored if it matches any entry — so the allowlist has to be
 * rewritten, and copying it here verbatim would silently drift the next time
 * jest-expo updates. Editing the preset's own string keeps that from happening;
 * `jestTransform.test.ts` fails loudly if the substitution ever stops matching.
 */
const ALLOWED = '@rn-primitives';

module.exports = {
  preset: 'jest-expo',
  /**
   * Raised from 30s in #112.
   *
   * Nothing got slower to *run*; the cold transform got more expensive again.
   * #108 put NativeWind's babel transform in front of every suite, and #112
   * widened the transform allowlist to `@rn-primitives` and added four more
   * suites competing for workers. On a cold cache the whole run measures 26–80s
   * depending on how empty the caches are, and under that contention a single
   * test in `signIn.test.tsx` — the file that pays the first `render`'s
   * React Native init — crossed 30s on roughly one cold run in three. It passes
   * in 8s in isolation, which is the signature of contention rather than a slow
   * test.
   *
   * **CI only ever runs cold**, so a one-in-three cold flake is a one-in-three
   * CI flake. The frontend job's `timeout-minutes: 15` leaves ample room.
   *
   * Raised rather than chased with a per-file override: see `README.md`, and
   * see the `jest.setTimeout(20_000)` this repo already removed once. Keep
   * `asyncUtilTimeout` in `jest.setup.js` below this number.
   */
  testTimeout: 60000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // NativeWind's stylesheet, which jest has no transform for. See
    // `jest.cssStub.js`.
    '\\.css$': '<rootDir>/jest.cssStub.js',
  },
  transformIgnorePatterns: transformIgnorePatterns.map((pattern) =>
    pattern.replace('(?!(.pnpm|', `(?!(.pnpm|${ALLOWED}|`),
  ),
};
