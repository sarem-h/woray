const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Ensure Metro watches the monorepo root for hoisted dependencies
config.watchFolders = [monorepoRoot];

// Ensure node_modules resolution checks both local and root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// ---------------------------------------------------------------------------
// DEV-CLIENT-ONLY WORKAROUND:
// The native dev-client shell (.ipa) was compiled WITHOUT the `ExpoAsset`
// native module, but `expo/src/Expo.fx.tsx` does `import 'expo-asset'` at
// startup, which crashes Hermes with "Cannot find native module 'ExpoAsset'".
// Redirect all `expo-asset` imports to a local no-op stub. See expo-asset-stub.js.
// ---------------------------------------------------------------------------
const expoAssetStub = path.resolve(projectRoot, 'expo-asset-stub.js');

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo-asset' || moduleName.startsWith('expo-asset/')) {
    return {
      type: 'sourceFile',
      filePath: expoAssetStub,
    };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
