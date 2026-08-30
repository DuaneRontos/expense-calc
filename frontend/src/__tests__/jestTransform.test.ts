/*
 * `require`, not `import`: both of these are CommonJS config files that ship no
 * type declarations and no ESM entry, and this test's whole purpose is to read
 * what jest itself will read. An `import` here would be describing a different
 * module system than the one under test.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const jestConfig = require('../../jest.config.js');
const { transformIgnorePatterns: presetPatterns } = require('jest-expo/jest-preset');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * `@rn-primitives/*` must stay transformable.
 *
 * The packages ship **untranspiled JSX** — `dist/index.js` contains a literal
 * `return <>…` and the `.mjs` is no different. Metro transforms it; jest does
 * not transform `node_modules` by default, so without an allowlist entry the
 * whole suite dies with `SyntaxError: Unexpected token '<'` pointing inside the
 * package rather than at any test.
 *
 * `jest.config.js` cannot state the allowlist additively — a file is ignored if
 * it matches *any* pattern — so it rewrites jest-expo's negative lookahead by
 * string substitution. **That substitution is the fragile part**: if jest-expo
 * changes the shape of its pattern, `.replace()` finds nothing, silently
 * returns the original, and the suite starts failing inside a dependency.
 *
 * This test is the tripwire, and it compares against the preset rather than a
 * copied string so it cannot pass by agreeing with a stale expectation.
 */
describe('the jest transform allowlist', () => {
  const scoped = '/node_modules/@rn-primitives/slot/dist/index.js';

  it('does not ignore @rn-primitives', () => {
    const ignored = jestConfig.transformIgnorePatterns.some((pattern: string) =>
      new RegExp(pattern).test(scoped),
    );

    expect(ignored).toBe(false);
  });

  it('would ignore it without the rewrite, so the rewrite is doing the work', () => {
    // Guards the guard: if the preset ever started allowing @rn-primitives on
    // its own, the assertion above would pass for a reason that has nothing to
    // do with jest.config.js, and the rewrite could be deleted unnoticed.
    const ignoredByPreset = presetPatterns.some((pattern: string) =>
      new RegExp(pattern).test(scoped),
    );

    expect(ignoredByPreset).toBe(true);
  });

  it('still ignores an unrelated dependency', () => {
    // The rewrite widens the allowlist by one scope, not into a blanket
    // "transform everything", which would be slow and would mask packages that
    // genuinely ship broken output.
    const ignored = jestConfig.transformIgnorePatterns.some((pattern: string) =>
      new RegExp(pattern).test('/node_modules/tailwind-merge/dist/bundle-mjs.mjs'),
    );

    expect(ignored).toBe(true);
  });
});
