/**
 * Added for NativeWind (spike #108). `withNativeWind` installs the transformer
 * that compiles Tailwind classes into `StyleSheet` objects at build time —
 * this is the half that `npm install` cannot vouch for, and the reason #108
 * gates on `expo export --platform all` rather than on a clean resolve.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
