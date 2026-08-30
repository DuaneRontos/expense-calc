/**
 * What `rem` means on a device.
 *
 * A browser resolves `rem` against the root font size. There is no root font
 * size on iOS or Android, so css-interop substitutes a constant — and its
 * default is **14**, not the 16 every Tailwind utility is designed around. Left
 * at the default, every rem-based class renders 12.5% smaller on native than in
 * the browser it was checked in.
 *
 * **This lives in its own CommonJS module so two very different consumers can
 * share one number.** `metro.config.js` is plain Node and cannot import a
 * TypeScript module; `tokensMatchTailwind.test.ts` needs the same value to
 * convert Tailwind's rem scale back to device pixels. Before this file, the
 * test hardcoded `16` — so deleting `inlineRem` from the metro config restored
 * the 14 default, shrank every spacing class on device, and left the test that
 * exists to catch exactly that **green**.
 *
 * Not a `.ts` file for the same reason `tailwind.config.ts` is not a `.js` one:
 * each has to be readable by the tool that loads it. `allowJs` lets TypeScript
 * consume this one.
 */
const INLINE_REM = 16;

module.exports = { INLINE_REM };
