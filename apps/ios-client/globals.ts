/**
 * Pure-JS Web API globals required by livekit-client on React Native Hermes.
 *
 * Hermes does NOT provide global `TextDecoder` / `TextEncoder`, and several
 * LiveKit / protobuf code paths instantiate `new TextDecoder('utf-8', { fatal: true })`.
 * Popular polyfills (e.g. fast-text-encoding) throw on the unsupported `fatal`
 * option, which crashes the bundle at import time. This hand-rolled UTF-8
 * implementation accepts (and safely ignores) every constructor option, so it is
 * immune to any dependency's option usage. It is 100% pure JS with zero native code.
 */

/* eslint-disable no-bitwise */

// ----------------------------------------------------------------------------
// WeakRef & FinalizationRegistry polyfills for Hermes (React Native 0.76)
//
// LiveKit client relies on ES2021 WeakRef and FinalizationRegistry.
// Hermes on React Native 0.76 does not implement them.
// Note: This WeakRef shim holds strong references (dev-only acceptable; leaks at scale).
// ----------------------------------------------------------------------------
if (typeof (globalThis as any).WeakRef === 'undefined') {
  (globalThis as any).WeakRef = class WeakRef<T extends object = object> {
    private readonly target: T;
    constructor(target: T) {
      this.target = target;
    }
    deref(): T | undefined {
      return this.target;
    }
  };
}

if (typeof (globalThis as any).FinalizationRegistry === 'undefined') {
  (globalThis as any).FinalizationRegistry = class FinalizationRegistry<T = any> {
    constructor(_cleanupCallback: (heldValue: T) => void) {}
    register(_target: object, _heldValue: T, _unregisterToken?: object): void {}
    unregister(_unregisterToken: object): boolean {
      return false;
    }
  };
}

// Unicode replacement character used for malformed UTF-8 sequences
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

class TextEncoderPolyfill {
  readonly encoding = 'utf-8';

  encode(input: string = ''): Uint8Array {
    const str = String(input);
    const bytes: number[] = [];

    for (let i = 0; i < str.length; i++) {
      let codePoint = str.charCodeAt(i);

      // Surrogate pair
      if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }

      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >> 18));
        bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }

    return Uint8Array.from(bytes);
  }

  encodeInto(source: string, destination: Uint8Array): { read: number; written: number } {
    const encoded = this.encode(source);
    const length = Math.min(encoded.length, destination.length);
    destination.set(encoded.subarray(0, length));
    return { read: source.length, written: length };
  }
}

class TextDecoderPolyfill {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  // Accept (and ignore) all options — Hermes livekit-client passes { fatal: true }
  constructor(encoding: string = 'utf-8', options?: { fatal?: boolean; ignoreBOM?: boolean }) {
    this.encoding = String(encoding).toLowerCase();
    this.fatal = Boolean(options?.fatal);
    this.ignoreBOM = Boolean(options?.ignoreBOM);
  }

  decode(input?: ArrayBuffer | ArrayBufferView, _options?: { stream?: boolean }): string {
    if (input == null) return '';

    const bytes: Uint8Array =
      input instanceof Uint8Array
        ? input
        : new Uint8Array((input as ArrayBufferView).buffer ?? (input as ArrayBuffer));

    const chunks: string[] = [];
    let i = 0;

    // Skip UTF-8 BOM unless ignoreBOM is set
    if (
      !this.ignoreBOM &&
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      i = 3;
    }

    while (i < bytes.length) {
      const byte1 = bytes[i];

      if (byte1 < 0x80) {
        chunks.push(String.fromCharCode(byte1));
        i += 1;
        continue;
      }

      let codePoint = 0;
      let needed = 0;

      if (byte1 >= 0xc2 && byte1 <= 0xdf) {
        codePoint = byte1 & 0x1f;
        needed = 1;
      } else if (byte1 >= 0xe0 && byte1 <= 0xef) {
        codePoint = byte1 & 0x0f;
        needed = 2;
      } else if (byte1 >= 0xf0 && byte1 <= 0xf4) {
        codePoint = byte1 & 0x07;
        needed = 3;
      } else {
        // Invalid leading byte
        chunks.push(REPLACEMENT_CHAR);
        i += 1;
        continue;
      }

      // Not enough continuation bytes left in buffer
      if (i + needed > bytes.length - 1) {
        chunks.push(REPLACEMENT_CHAR);
        i += 1;
        continue;
      }

      let valid = true;
      for (let j = 1; j <= needed; j++) {
        const byteN = bytes[i + j];
        if (byteN === undefined || (byteN & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (byteN & 0x3f);
      }

      if (!valid) {
        chunks.push(REPLACEMENT_CHAR);
        i += 1;
        continue;
      }

      chunks.push(
        codePoint > 0xffff
          ? String.fromCharCode(
              0xd800 + ((codePoint - 0x10000) >> 10),
              0xdc00 + ((codePoint - 0x10000) & 0x3ff)
            )
          : String.fromCharCode(codePoint)
      );
      i += needed + 1;
    }

    return chunks.join('');
  }
}

// ----------------------------------------------------------------------------
// Install globals on globalThis before livekit-client evaluates.
// ----------------------------------------------------------------------------
const g = globalThis as any;

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = TextEncoderPolyfill;
}

if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = TextDecoderPolyfill;
}

// Initialize the native WebRTC C++ core and configure iOS AVAudioSession in
// bidirectional voice-communication mode with hardware Acoustic Echo Cancellation.
//
// Uses `require` (NOT `import`) so the TextDecoder/TextEncoder polyfills above are
// guaranteed to be installed on globalThis BEFORE any LiveKit / WebRTC code
// evaluates — an ES `import` would be hoisted above the polyfill installation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerGlobals } = require('@livekit/react-native');

registerGlobals();
