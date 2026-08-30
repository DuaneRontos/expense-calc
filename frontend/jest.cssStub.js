/**
 * Stands in for a stylesheet import under jest.
 *
 * `app/_layout.tsx` imports `global.css` so NativeWind can inject its compiled
 * styles. Metro handles that; jest does not — its `transform` covers images and
 * `.[jt]sx?` only, so a test that reaches the root layout parses `@tailwind
 * base;` as JavaScript and dies with `SyntaxError: Invalid or unexpected
 * token`, naming `global.css` rather than the missing mapper.
 *
 * Nothing imports the root layout today, so this is a landmine rather than a
 * live failure — but the first test to import it would spend a while on an
 * error that points at the wrong file. Wired up in `package.json`'s
 * `moduleNameMapper`.
 *
 * Styles are not under test here: components are asserted through the
 * accessibility tree and rendered output, so an empty object is the whole
 * fixture.
 */
module.exports = {};
