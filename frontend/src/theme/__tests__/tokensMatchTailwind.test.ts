import { readFileSync } from 'fs';
import { join } from 'path';

import resolveConfig from 'tailwindcss/resolveConfig';

import tailwindConfig from '../../../tailwind.config';
import { BREAKPOINTS, MIN_TOUCH_TARGET } from '../../layout/breakpoints';
import { INLINE_REM } from '../rem';
import { categoryColors, palette, spacing } from '../tokens';

/**
 * The palette has two consumers and must not fork.
 *
 * Tailwind classes style the components; `react-native-svg` takes literal
 * colour strings for `fill` and `stroke`, because an SVG element cannot read a
 * class. So a chart slice and the legend swatch beside it reach the same colour
 * by two different routes, and nothing at runtime would notice them diverging —
 * the chart would simply be drawn in the old colour and still look plausible.
 *
 * `tailwind.config.ts` imports `tokens.ts` precisely so they cannot diverge.
 * This suite is what keeps that true if someone reintroduces a literal.
 */
const resolved = resolveConfig(tailwindConfig);

/**
 * The rem basis has to be the one the device actually uses.
 *
 * Sharing `INLINE_REM` between `metro.config.js` and the spacing assertion
 * below is necessary but **not sufficient**: with the constant shared and
 * nothing else, deleting `inlineRem` from the metro config still left every
 * assertion green, because the test was reading a module the build had stopped
 * consulting. So this scans the config's source, in the spirit of
 * `src/__tests__/timeoutOverrides.test.ts` and the storage scan in
 * `api/__tests__/refreshTokenStore.web.test.ts`.
 *
 * Without it, css-interop's default of 14 comes back and every rem-based class
 * renders 12.5% smaller on iOS and Android — silently, because the browser
 * still looks right.
 */
describe('the metro config', () => {
  /**
   * Comments stripped first, for the reason `timeoutOverrides.test.ts` gives:
   * prose about a rule would otherwise satisfy a scan for the rule.
   *
   * `metro.config.js` is unusually exposed to that — the setting is one line
   * under a doc block that already names both identifiers. Delete the line,
   * leave the paragraph, and a raw scan stays green over a config that sets
   * nothing.
   */
  const source = readFileSync(join(__dirname, '..', '..', '..', 'metro.config.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('sets inlineRem from the shared constant', () => {
    expect(source).toMatch(/inlineRem:\s*INLINE_REM\b/);
  });

  it('binds that constant to the require, not merely near it', () => {
    // Guards the guard: `inlineRem: INLINE_REM` proves nothing if `INLINE_REM`
    // is a local literal declared in the config itself.
    //
    // **The binding has to be in the pattern.** Matching the `require` alone
    // was not enough — a detached `require('./src/theme/rem.js');` beside a
    // local `const INLINE_REM = 14` satisfied it, left all seven assertions
    // green, and shrank every rem-based class 12.5% on device. That is the
    // exact failure this scan exists for, so the destructuring and the call
    // are matched as one thing.
    expect(source).toMatch(
      /const\s*\{\s*INLINE_REM\s*\}\s*=\s*require\(['"]\.\/src\/theme\/rem(\.js)?['"]\)/,
    );
  });
});

/**
 * The touch tokens must be *derived* from `MIN_TOUCH_TARGET`, not written out.
 *
 * A literal that agrees with the constant today is invisible to every
 * assertion on the resolved theme — `'88px'` and `` `${MIN_TOUCH_TARGET * 2}px` ``
 * are the same string — and stays invisible right up until someone changes
 * `MIN_TOUCH_TARGET` and only two of the three tokens follow it.
 *
 * Same shape and same remedy as the `inlineRem` scan below: read the source,
 * strip the comments first so prose naming a value cannot satisfy a scan for
 * the value.
 */
describe('the Tailwind config', () => {
  const source = readFileSync(join(__dirname, '..', '..', '..', 'tailwind.config.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('derives every touch token from MIN_TOUCH_TARGET', () => {
    // One `touch: ` for minHeight, one for minWidth, one `touch-2`.
    expect(source.match(/touch:\s*`\$\{MIN_TOUCH_TARGET\}px`/g)).toHaveLength(2);
    expect(source).toMatch(/'touch-2':\s*`\$\{MIN_TOUCH_TARGET \* 2\}px`/);
  });

  it('writes no pixel literal into the touch scale', () => {
    // Guards the guard: the assertions above would still pass if a fourth token
    // were added as a literal beside them.
    const touchScale = source.slice(source.indexOf('minHeight:'), source.indexOf('plugins:'));

    expect(touchScale).not.toMatch(/'\d+px'/);
  });
});

describe('the Tailwind theme and the app tokens', () => {
  it('gives every taxonomy category a colour, from the same object the charts read', () => {
    const categories = (resolved.theme.colors as unknown as { category: Record<string, string> })
      .category;

    // Not a spot check: a category added to the taxonomy without a colour here
    // is the failure this guards, so the whole key set is compared.
    expect(Object.keys(categories).sort()).toEqual(Object.keys(categoryColors).sort());

    for (const [category, color] of Object.entries(categoryColors)) {
      expect(categories[category]).toBe(color);
    }
  });

  it('carries the app palette', () => {
    const colors = resolved.theme.colors as unknown as Record<string, string>;

    for (const [name, value] of Object.entries(palette)) {
      expect(colors[name]).toBe(value);
    }
  });

  it('derives its breakpoints from BREAKPOINTS, including the exclusive upper band', () => {
    // `expanded` is `> 1024`, and a Tailwind screen is `>=` — so the config has
    // to add one. An iPad in landscape is exactly 1024pt and belongs to
    // `medium`; this is the assertion that catches someone "tidying" the `+ 1`.
    expect(resolved.theme.screens).toMatchObject({
      medium: `${BREAKPOINTS.compact}px`,
      expanded: `${BREAKPOINTS.expanded + 1}px`,
    });

    expect(resolved.theme.screens).not.toHaveProperty('sm');
    expect(resolved.theme.screens).not.toHaveProperty('lg');
  });

  it('names the touch-target floor on both axes', () => {
    // `min-h-11` is 44 only while `inlineRem` is 16. `min-h-touch` is 44
    // because `MIN_TOUCH_TARGET` is.
    //
    // Width as well as height: an unknown Tailwind class compiles to nothing
    // rather than failing, so `min-w-touch` used without being defined leaves a
    // square button's hit area unconstrained horizontally and says nothing.
    expect(resolved.theme.minHeight.touch).toBe(`${MIN_TOUCH_TARGET}px`);
    expect(resolved.theme.minWidth.touch).toBe(`${MIN_TOUCH_TARGET}px`);

    // The multiline field's height. `cn.test.ts` walks `extend` and picked this
    // key up for free, but nothing pinned the number.
    //
    // **This catches a wrong value, not a hardcoded one.** `'88px'` and
    // `` `${MIN_TOUCH_TARGET * 2}px` `` resolve to the same string, so no
    // assertion on the resolved theme can tell a derivation from a literal that
    // happens to agree with it today — the scan below is what does that.
    expect(resolved.theme.minHeight['touch-2']).toBe(`${MIN_TOUCH_TARGET * 2}px`);
  });

  it('already expresses the spacing steps, so no second set of names was invented', () => {
    // `spacing.md` is 16, and Tailwind's `4` is 16 — the scales agree, so the
    // app's steps are reachable as ordinary Tailwind classes (`p-4`, `gap-2`).
    // Pinned because the temptation is to add `p-md` and end up with two ways
    // to say one thing.
    const scale = resolved.theme.spacing as Record<string, string>;

    // `INLINE_REM`, not a literal 16. This assertion converts Tailwind's rem
    // scale into device pixels, so it has to use the same basis the device
    // will. When it hardcoded the number, deleting `inlineRem` from
    // `metro.config.js` restored css-interop's default of 14 — every spacing
    // class shrank 12.5% on iOS and Android — and this test stayed green,
    // because it was comparing a constant against itself.
    const px = (step: string) => Number.parseFloat(scale[step]!) * INLINE_REM;

    expect(px('1')).toBe(spacing.xs);
    expect(px('2')).toBe(spacing.sm);
    expect(px('4')).toBe(spacing.md);
    expect(px('6')).toBe(spacing.lg);
    expect(px('8')).toBe(spacing.xl);
  });
});
