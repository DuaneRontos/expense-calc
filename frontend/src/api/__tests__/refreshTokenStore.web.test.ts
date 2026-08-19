import { readdirSync, readFileSync } from 'node:fs';
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

  it('never reaches for script-readable storage, anywhere in src', () => {
    // Asserted against the source rather than by spying, in the spirit of the
    // backend's NoAbsoluteValueInMoneyPathsTest: spec §9.2 and §10 forbid
    // localStorage outright, sessionStorage is the same script-readable
    // exposure with a shorter life, and a non-httpOnly cookie buys persistence
    // without the protection that made the spec ask for a cookie.
    //
    // Scanned across the whole tree rather than a list of files. The tempting
    // fix for "a reload signs me out" lands wherever the person hitting the
    // problem happens to be — a useAuth hook, a layout, a new sessionCache.ts —
    // and a hardcoded list stays green precisely there. This keeps working as
    // #14 to #16 add screens, with no edit that the person adding localStorage
    // would have to remember to make.
    const forbidden = ['localStorage', 'sessionStorage', 'document.cookie'];
    const root = join(__dirname, '..', '..');

    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'));

    // Guards the guard: a glob that matched nothing would pass silently.
    expect(sources.length).toBeGreaterThan(10);

    for (const file of sources) {
      // Strip comments — several files name all three while explaining why none
      // is used, and a naive scan would fail on the argument for its own rule.
      const code = readFileSync(join(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      for (const api of forbidden) {
        expect({ file, contains: code.includes(api) }).toEqual({ file, contains: false });
      }
    }
  });
});
