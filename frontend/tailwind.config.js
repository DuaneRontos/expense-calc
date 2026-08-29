/**
 * Added for NativeWind (spike #108).
 *
 * **Deliberately minimal.** This spike proves the build works; it does not
 * bridge `src/theme/tokens.ts` into the theme, which is #111's job and is
 * harder than it looks — this file is CommonJS and `tokens.ts` is TypeScript,
 * so a plain `require` of it does not work without a loader.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: {} },
  plugins: [],
};
