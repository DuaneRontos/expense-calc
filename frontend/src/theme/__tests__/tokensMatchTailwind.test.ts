import resolveConfig from 'tailwindcss/resolveConfig';

import tailwindConfig from '../../../tailwind.config';
import { BREAKPOINTS, MIN_TOUCH_TARGET } from '../../layout/breakpoints';
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
  });

  it('already expresses the spacing steps, so no second set of names was invented', () => {
    // `spacing.md` is 16, and Tailwind's `4` is 16 — the scales agree, so the
    // app's steps are reachable as ordinary Tailwind classes (`p-4`, `gap-2`).
    // Pinned because the temptation is to add `p-md` and end up with two ways
    // to say one thing.
    const scale = resolved.theme.spacing as Record<string, string>;
    const px = (step: string) => Number.parseFloat(scale[step]!) * 16;

    expect(px('1')).toBe(spacing.xs);
    expect(px('2')).toBe(spacing.sm);
    expect(px('4')).toBe(spacing.md);
    expect(px('6')).toBe(spacing.lg);
    expect(px('8')).toBe(spacing.xl);
  });
});
