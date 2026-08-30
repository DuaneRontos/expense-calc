import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * No file may set its own jest timeout.
 *
 * In the spirit of the backend's `NoAbsoluteValueInMoneyPathsTest`, and for the
 * reason the storage scan in `api/__tests__/refreshTokenStore.web.test.ts`
 * gives: the tempting fix lands wherever the person hitting the problem happens
 * to be, so a rule enforced by prose is enforced only on the people who read
 * that file.
 *
 * **The drift this exists to stop has already happened once.** `#86` added
 * `jest.setTimeout(20_000)` to `signIn.test.tsx` as a raise off jest's 5s
 * default. `#91` set `testTimeout: 30000` globally the next day, which turned
 * that line into a *lowering* — silently, in the suite's slowest file. Nothing
 * failed, so nothing noticed for months. Re-adding an override anywhere else
 * reproduces the whole story with a different filename.
 *
 * The remedy is the global: raise `testTimeout` in `package.json`, where one
 * number governs every file and cannot be overtaken by a later edit somewhere
 * else. See `frontend/README.md`.
 */
describe('jest timeout configuration', () => {
  it('is set in one place, with no per-file overrides anywhere in src', () => {
    const root = join(__dirname, '..');

    // **Includes `__tests__`, unlike the storage scan.** An override can only
    // appear in a test file, so excluding them would scan everything except the
    // place the rule applies.
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) =>
      /\.tsx?$/.test(file),
    );

    // Guards the guard: a glob that matched nothing would pass silently.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((file) => file.includes('__tests__'))).toBe(true);

    for (const file of sources) {
      // Strip comments first. `signIn.test.tsx` names `jest.setTimeout(20_000)`
      // in prose while explaining why it no longer calls it, and a naive scan
      // would fail on the argument for its own rule.
      const code = readFileSync(join(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect({ file, overridesTimeout: /jest\s*\.\s*setTimeout\s*\(/.test(code) }).toEqual({
        file,
        overridesTimeout: false,
      });
    }
  });
});
