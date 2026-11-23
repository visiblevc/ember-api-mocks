/**
 * This babel.config is not used for publishing.
 * It's only for the local editing experience
 * (and linting)
 */
const { buildMacros } = require('@embroider/macros/babel');

const {
  babelCompatSupport,
  templateCompatSupport,
} = require('@embroider/compat/babel');

const { createRequire } = require('node:module');

function configureWarpDrive(config) {
  let setConfig;
  try {
    const requireFromEmberData = createRequire(require.resolve('ember-data'));
    ({ setConfig } = requireFromEmberData(
      '@warp-drive/core/cjs-set-config.cjs',
    ));
  } catch {
    return;
  }
  setConfig(config, {});
}

const macros = buildMacros({ configure: configureWarpDrive });

// For scenario testing
const isCompat = Boolean(process.env.ENABLE_COMPAT_BUILD);

module.exports = {
  plugins: [
    [
      '@babel/plugin-transform-typescript',
      {
        allExtensions: true,
        allowDeclareFields: true,
        onlyRemoveTypeImports: true,
      },
    ],
    [
      'babel-plugin-ember-template-compilation',
      {
        transforms: [
          ...(isCompat ? templateCompatSupport() : macros.templateMacros),
        ],
      },
    ],
    [
      'module:decorator-transforms',
      {
        runtime: {
          import: require.resolve('decorator-transforms/runtime-esm'),
        },
      },
    ],
    ...(isCompat ? babelCompatSupport() : macros.babelMacros),
  ],

  generatorOpts: {
    compact: false,
  },
};
