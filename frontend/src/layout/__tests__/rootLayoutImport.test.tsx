/**
 * The root layout must be importable from a test.
 *
 * `app/_layout.tsx` imports `global.css` so NativeWind can inject its compiled
 * styles. Metro understands that; jest does not — its `transform` covers images
 * and `.[jt]sx?` only. Without the `moduleNameMapper` entry added alongside
 * this test, the import parses `@tailwind base;` as JavaScript and the suite
 * dies with `SyntaxError: Invalid or unexpected token` pointing at
 * `global.css`, which names the stylesheet rather than the missing mapper.
 *
 * **This test exists because nothing else imports the root layout.** The
 * routing suites mock it, so the breakage would have waited for whoever first
 * wrote a test that did — and it fails in a way that reads as a problem with
 * the CSS file. One import is enough to keep that from being a discovery.
 *
 * It asserts on the module, not on a render: mounting the real layout would
 * pull in the auth gate, the query provider and the whole shell, and this is
 * pinning the transform pipeline, not the tree.
 */
import RootLayout, { unstable_settings } from '../../../app/_layout';

describe('the root layout module', () => {
  it('loads, so the CSS import resolves under jest', () => {
    // A static import, so the stylesheet is resolved while the module graph is
    // built — the failure this guards against happens at load, before any
    // assertion would run.
    expect(typeof RootLayout).toBe('function');
  });

  it('still seeds Overview beneath a deep-linked child', () => {
    // Guards the `unstable_settings.anchor` contract in the same import, so
    // this file is not purely a transform check. Spelled `initialRouteName`
    // before SDK 54.
    expect(unstable_settings).toEqual({ anchor: 'index' });
  });
});
