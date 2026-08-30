/**
 * Added for NativeWind (spike #108).
 *
 * **Deliberately minimal otherwise.** This spike proves the build works; it
 * does not bridge `src/theme/tokens.ts` into the theme, which is #111's job and
 * is harder than it looks — this file is CommonJS and `tokens.ts` is
 * TypeScript, so a plain `require` of it does not work without a loader.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    /**
     * **Spec §2's three bands, not Tailwind's five.**
     *
     * Tailwind ships `sm:640 md:768 lg:1024 xl:1280`, and NativeWind's preset
     * does not override them. This app has three bands at 600 and 1024, in
     * `BREAKPOINTS` in `src/layout/breakpoints.ts`. Left at the defaults the
     * two systems disagree twice: `sm:` fires at 640 while `useLayout()` has
     * called it medium since 600, and — worse — they split at exactly 1024,
     * because `layoutSizeFor` puts 1024 in *medium* deliberately and Tailwind's
     * `lg:` is `>=`. An iPad in landscape is exactly 1024pt, which the
     * breakpoints docstring singles out as a real device with a test pinning
     * it.
     *
     * Replaced rather than extended, so a stray `sm:` or `lg:` fails loudly
     * instead of silently resolving to a boundary this app does not have.
     * `expanded` is `1025px` because spec §2 writes the band as `> 1024`, not
     * `>=`.
     *
     * These names have to keep matching `LayoutSize` in `breakpoints.ts`.
     * `compact` needs no entry: it is the unprefixed base.
     */
    screens: {
      medium: '600px',
      expanded: '1025px',
    },
    extend: {},
  },
  plugins: [],
};
