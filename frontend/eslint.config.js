const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `dist-check/*` alongside `dist/*`: both hold generated bundles, and
    // linting a Hermes-era build produces thousands of errors in code nobody
    // wrote. Added with the script that creates it — the two have to move
    // together or the next `export:check` run turns the lint gate red.
    ignores: ['dist/*', 'dist-check/*', 'node_modules/*', '.expo/*'],
  },
]);
