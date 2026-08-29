/**
 * Added for NativeWind (spike #108). **The repo had no babel config before
 * this**, and adding one is not free: `jest-expo` picks it up too, so all 28
 * suites now run through this pipeline. See `frontend/README.md` on the cold
 * transform budget that `testTimeout: 30000` exists to cover.
 *
 * `babel-preset-expo` is an explicit devDependency rather than an inherited
 * one. It ships inside `expo`, but npm leaves it at
 * `node_modules/expo/node_modules/babel-preset-expo` — unhoisted, so babel
 * cannot resolve it by name from the project root. Pinned to the version
 * `expo@57` bundles, and it has to move with the SDK.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // `jsxImportSource` routes JSX through NativeWind's runtime, which is
      // what lets `className` reach a React Native component at all.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
