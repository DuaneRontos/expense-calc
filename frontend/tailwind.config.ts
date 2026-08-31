import nativewindPreset from 'nativewind/preset';
import type { Config } from 'tailwindcss';

import { BREAKPOINTS, MIN_TOUCH_TARGET } from './src/layout/breakpoints';
import { categoryColors, palette } from './src/theme/tokens';

/**
 * Tailwind's half of the styling system (#111).
 *
 * **TypeScript on purpose.** Tailwind loads its config through `jiti` with a
 * sucrase TypeScript transform, so this file can import the app's real modules
 * rather than restating their values. That is the whole point: `tokens.ts` and
 * `breakpoints.ts` stay the single source of truth, and every number below is
 * *derived* from them. The previous `.js` version hard-coded `600px` and
 * `1025px`, which were correct and unpinned — nothing would have noticed them
 * drifting from `BREAKPOINTS`.
 *
 * **`tokens.ts` is not replaced by this file and must not be.** `react-native-svg`
 * takes colours as `fill`/`stroke` prop values, and an SVG element cannot read a
 * Tailwind class — so the charts need `categoryColors` as a runtime JS export
 * regardless of what Tailwind knows. Both consumers reading one export is what
 * keeps a chart slice and its legend swatch provably the same colour.
 */
export default {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    /**
     * Spec §2's three bands, not Tailwind's five, and now computed from
     * `BREAKPOINTS` rather than copied from it.
     *
     * Replaced rather than extended, so a stray `sm:` or `lg:` fails loudly
     * instead of silently resolving to 640 or 1024 — boundaries this app does
     * not have. `compact` needs no entry: it is the unprefixed base.
     *
     * `expanded` is `+ 1` because spec §2 writes the band as `> 1024` while a
     * Tailwind screen is `>=`. `layoutSizeFor` puts exactly 1024 in *medium*
     * deliberately — an iPad in landscape is 1024pt — so the off-by-one is the
     * thing that keeps the two systems agreeing on a real device.
     */
    screens: {
      medium: `${BREAKPOINTS.compact}px`,
      expanded: `${BREAKPOINTS.expanded + 1}px`,
    },
    extend: {
      /**
       * The app palette, plus one `category-*` colour per taxonomy entry.
       *
       * Spread from the same objects the charts import. A category added to the
       * taxonomy appears here automatically; there is no second list to update,
       * which is the failure this indirection exists to prevent.
       */
      colors: {
        ...palette,
        category: categoryColors,
      },
      /**
       * `min-h-touch` and `min-w-touch`, tied to the constant rather than to a
       * number that happens to match it.
       *
       * `min-h-11` is 44 only because `metro.config.js` sets `inlineRem: 16`;
       * at NativeWind's default of 14 the same class is 38.5. Naming the
       * constant means the touch-target floor cannot be broken by a change to
       * the rem basis, which is exactly how it broke during #108.
       *
       * **Both axes, because a floor on one is not a target.** An icon button
       * is square and constrains its width too; `Button` used `min-w-touch`
       * before it existed here, and an unknown Tailwind class compiles to
       * nothing at all rather than failing — so the hit area was silently
       * unconstrained horizontally.
       */
      minHeight: {
        touch: `${MIN_TOUCH_TARGET}px`,
      },
      minWidth: {
        touch: `${MIN_TOUCH_TARGET}px`,
      },
    },
  },
  plugins: [],
} satisfies Config;
