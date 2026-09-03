import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { MIN_TOUCH_TARGET } from '../layout/breakpoints';

/**
 * No source file may set a minimum size below the touch-target floor.
 *
 * `Button` carries `min-h-touch` as a **default, not a lock** — #130 settled
 * that deliberately, and `button.test.tsx` pins it on the composed
 * `className`. Spec §2's touch-target sentence governs breakpoints: it forbids
 * the target shrinking as the window grows, which an unprefixed floor cannot
 * do. It does not forbid a caller passing a smaller height for a reason.
 *
 * **The gap this closes is what happens next.** `Button.tsx` says a shrinking
 * call site "is opting out in writing, and spec §2 makes that a review question
 * for whoever writes it" — and nothing noticed `<Button className="min-h-0">`.
 * That made the guarantee depend on a reviewer recalling a doc block in a file
 * they are not editing, across the many call sites #113 onward touched. Three of
 * the last four findings on #130 were guarantees that were documented and not
 * enforced, and every one was found by someone executing rather than reading.
 *
 * So opting out now means adding an entry to {@link ALLOWED} — which someone has
 * to look at — rather than the opt-out being spelled out where nobody re-reads
 * it. Same shape as the backend's `NoAbsoluteValueInMoneyPathsTest` and as
 * `timeoutOverrides.test.ts` next door.
 *
 * ## Why the rem-based scale is refused outright, even at 44
 *
 * `min-h-11` is 44 **only** while `metro.config.js` sets `inlineRem: 16`. At
 * NativeWind's default of 14 the same class is 38.5dp, which is how the floor
 * broke during #108 — silently, because an unknown or mis-sized Tailwind class
 * compiles to something plausible rather than failing. CLAUDE.md states the rule
 * as "never `min-h-11`", and a scan that accepted it because it happens to
 * compute to 44 today would enforce the arithmetic rather than the rule.
 *
 * An explicit `min-h-[60px]` stays legal: the floor is a floor, not a fixed
 * height, and a pixel value cannot drift with the rem basis.
 */

/** The classes that carry the floor, derived in `tailwind.config.ts`. */
const FLOOR_CLASSES = ['min-h-touch', 'min-h-touch-2', 'min-w-touch'];

/**
 * Deliberate exceptions, each with the reason it is one.
 *
 * Empty today, and that is the point of writing it down: there is no call site
 * in `app/` or `src/` that shrinks a minimum below the floor, so the first one
 * to want to has to say so here.
 */
const ALLOWED: { file: string; class: string; why: string }[] = [];

/** `min-h-…` / `min-w-…` occurrences, with the arbitrary-value form included. */
const MIN_SIZE = /\bmin-[hw]-(\[[^\]]+\]|[A-Za-z0-9.-]+)/g;

/**
 * Whether one occurrence breaks the floor.
 *
 * Three shapes reach here. The named floor classes pass. An arbitrary value
 * passes only if it is a pixel length at or above the floor — `min-h-[38px]` is
 * the form most likely to be written by someone who has not thought about the
 * floor at all, and `min-h-[0px]` is the same mistake spelled differently.
 * Anything on the bare numeric scale is refused for the rem reason above.
 */
function breaksFloor(occurrence: string): boolean {
  if (FLOOR_CLASSES.includes(occurrence)) {
    return false;
  }

  const value = occurrence.replace(/^min-[hw]-/, '');

  if (value.startsWith('[')) {
    const px = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);
    // A non-px arbitrary value (`[3rem]`, `[10%]`) is refused rather than
    // computed: the rem basis is the thing that broke, and a percentage of an
    // unknown parent is not a floor at all.
    return px === null || Number(px[1]) < MIN_TOUCH_TARGET;
  }

  // `full`, `screen`, `min`, `fit` and friends do not set a numeric floor below
  // anything; only the rem-derived scale does.
  return /^\d/.test(value);
}

/**
 * **`__tests__` is excluded, which is the opposite of what
 * `timeoutOverrides.test.ts` does — and the reason is the opposite too.**
 *
 * A `jest.setTimeout` override can *only* appear in a test file, so a scan that
 * skipped them would check everywhere except the place the rule applies. A
 * touch target can only be undercut where a component is rendered for real, and
 * the test files that name these classes are exercising the floor rather than
 * breaking it: `cn.test.ts` asserts that `min-h-0` beats `min-h-touch` in the
 * merge, and `button.test.tsx` pins that a caller *can* shrink the default.
 * Flagging those would report this rule's own coverage as violations of it, and
 * a guard that cries wolf on its own test suite is one somebody turns off.
 */
function sourcesUnder(root: string, prefix: string): { path: string; label: string }[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'))
    .map((file) => ({ path: join(root, file), label: `${prefix}/${file}` }));
}

describe('the touch-target floor', () => {
  it('is not undercut anywhere in app/ or src/', () => {
    const src = join(__dirname, '..');
    const app = join(__dirname, '..', '..', 'app');
    const sources = [...sourcesUnder(src, 'src'), ...sourcesUnder(app, 'app')];

    // Guards the guard: a glob that matched nothing would pass silently, which
    // is the failure `timeoutOverrides.test.ts` calls out next door.
    expect(sources.length).toBeGreaterThan(40);
    expect(sources.some((file) => file.label.startsWith('app/'))).toBe(true);
    expect(sources.some((file) => file.label.startsWith('src/'))).toBe(true);

    const violations: string[] = [];

    for (const source of sources) {
      // Comments stripped first, for the reason `timeoutOverrides.test.ts`
      // gives: this file's own prose names `min-h-11` and `min-h-[38px]` while
      // explaining why they are refused, and a naive scan would fail on the
      // argument for its own rule.
      const code = readFileSync(source.path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      for (const [occurrence] of code.matchAll(MIN_SIZE)) {
        if (!breaksFloor(occurrence)) {
          continue;
        }
        const allowed = ALLOWED.some(
          (entry) => entry.file === source.label && entry.class === occurrence,
        );
        if (!allowed) {
          violations.push(`${source.label}: ${occurrence}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * The rule itself, so the scan above cannot pass by being unable to see
   * anything. It reports zero violations across a real tree; without this,
   * that is equally consistent with a predicate that never returns true.
   */
  it('refuses the shapes it exists to refuse', () => {
    // The floor, and its documented multiple.
    expect(breaksFloor('min-h-touch')).toBe(false);
    expect(breaksFloor('min-h-touch-2')).toBe(false);
    expect(breaksFloor('min-w-touch')).toBe(false);

    // A bigger explicit floor is legal — a floor, not a fixed height.
    expect(breaksFloor('min-h-[60px]')).toBe(false);
    expect(breaksFloor(`min-h-[${MIN_TOUCH_TARGET}px]`)).toBe(false);

    // The two forms the issue names.
    expect(breaksFloor('min-h-[38px]')).toBe(true);
    expect(breaksFloor('min-h-0')).toBe(true);

    // 44 today, 38.5 at NativeWind's default rem — refused on the rule rather
    // than on today's arithmetic.
    expect(breaksFloor('min-h-11')).toBe(true);
    expect(breaksFloor('min-w-11')).toBe(true);

    // Units that cannot be checked against a pixel floor.
    expect(breaksFloor('min-h-[2.5rem]')).toBe(true);
    expect(breaksFloor('min-h-[50%]')).toBe(true);

    // Keywords set no numeric floor.
    expect(breaksFloor('min-h-full')).toBe(false);
  });
});
