/**
 * Added for NativeWind (spike #108). `withNativeWind` installs the transformer
 * that compiles Tailwind classes into `StyleSheet` objects at build time —
 * this is the half that `npm install` cannot vouch for, and the reason #108
 * gates on `expo export --platform all` rather than on a clean resolve.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const { INLINE_REM } = require('./src/theme/rem.js');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: './global.css',
  /**
   * **`rem` on a device is a constant, and NativeWind's default is not 16.**
   *
   * A browser resolves `rem` against the root font size; there is no such thing
   * on iOS or Android, so css-interop substitutes `inlineRem` — which defaults
   * to **14**, not the 16 every Tailwind utility is designed around. Left
   * alone, every rem-based class renders 12.5% smaller on native than in the
   * browser it was checked in: `text-base` 16 vs 14, `p-4` 16 vs 14.
   *
   * That is a silent divergence rather than a visible break, and it lands
   * hardest on the one dimension this repo pins. `min-h-11` is
   * `min-height: 2.75rem` — 44px on web, and **38.5dp on device** at the
   * default. That is below iOS's 44pt, below Android's 48dp, and below
   * `MIN_TOUCH_TARGET` in `src/layout/breakpoints.ts`, which spec §2 requires
   * at every breakpoint.
   *
   * Set from `src/theme/rem.js` so a Tailwind spacing class means the same
   * thing on all three targets. **Shared rather than written here** because
   * `tokensMatchTailwind.test.ts` needs the same number to convert Tailwind's
   * rem scale back to device pixels — when it had its own copy, removing this
   * line left that test green while the app shrank.
   */
  inlineRem: INLINE_REM,
});
