import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { refreshTokenStore } from '../refreshTokenStore.web';

/**
 * The web store is imported by path rather than through Metro's platform
 * resolution, which only applies to a real bundle. Jest runs the native variant
 * for everything else, so without this the web half of spec §9.2's storage
 * table would be type-checked and never executed.
 */
describe('web refresh token store', () => {
  afterEach(async () => {
    await refreshTokenStore.clear();
  });

  it('round-trips a token in memory', async () => {
    await refreshTokenStore.write('refresh-1');
    expect(await refreshTokenStore.read()).toBe('refresh-1');
  });

  it('starts empty and clears back to empty', async () => {
    expect(await refreshTokenStore.read()).toBeNull();

    await refreshTokenStore.write('refresh-1');
    await refreshTokenStore.clear();

    expect(await refreshTokenStore.read()).toBeNull();
  });

  it('never reaches for script-readable storage', () => {
    // Asserted against the source rather than by spying, in the spirit of the
    // backend's NoAbsoluteValueInMoneyPathsTest: spec §9.2 and §10 forbid
    // localStorage outright, sessionStorage is the same script-readable
    // exposure with a shorter life, and a non-httpOnly cookie buys persistence
    // without the protection that made the spec ask for a cookie.
    //
    // The tempting fix for "a refresh signs the user out" is exactly one of
    // these three, which is why the rule is pinned rather than trusted.
    const forbidden = ['localStorage', 'sessionStorage', 'document.cookie'];

    for (const file of ['refreshTokenStore.web.ts', 'refreshTokenStore.ts', 'session.ts']) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      // Strip comments — this file's own docs name all three while explaining
      // why none of them is used, and a naive scan would fail on the argument
      // for the rule it is enforcing.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      for (const api of forbidden) {
        expect(code).not.toContain(api);
      }
    }
  });
});
