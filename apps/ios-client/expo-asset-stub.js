/**
 * No-op stub for `expo-asset` in the DEV CLIENT only.
 *
 * Why this exists:
 * The native iOS dev-client shell (.ipa) was compiled WITHOUT the `ExpoAsset`
 * native module (expo-asset is not a declared dependency — only a transitive one
 * of `expo`). At app startup, `expo/src/Expo.fx.tsx` does `import 'expo-asset'`,
 * which evaluates `requireNativeModule('ExpoAsset')` and crashes on Hermes with
 * "Cannot find native module 'ExpoAsset'".
 *
 * Your app never imports `expo-asset` directly, and Expo.fx only loads it to
 * register a custom RN asset `source` transformer (used for `Image`/`require`
 * of bundled binary assets — which this voice app does not use). Replacing it
 * with a no-op is therefore safe for the dev client.
 *
 * NOTE: This stub is ONLY wired up via metro.config.js `resolveRequest`, so it
 * affects the JS bundle — it does NOT change any native code. If you later add
 * `expo-asset` as a real dependency and rebuild the native shell, remove this
 * stub and the resolver override.
 */

// Minimal `Asset` shape so any incidental references don't crash.
class Asset {
  constructor({ uri, localUri, hash, type } = {}) {
    this.uri = uri;
    this.localUri = localUri ?? uri;
    this.hash = hash;
    this.type = type;
    this.downloaded = true;
    this.width = undefined;
    this.height = undefined;
    this.name = undefined;
  }

  static fromMetadata() {
    return new Asset();
  }

  static loadAsync() {
    return Promise.resolve([]);
  }

  async downloadAsync() {
    return this;
  }
}

module.exports = {
  Asset,
  // Common named exports from expo-asset that may be referenced
  useAssets: () => [undefined, undefined],
  loadAsync: () => Promise.resolve(),
};
