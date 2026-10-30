// apps/ios-client/theme/typography.ts
// Shared visual primitives for the Woray voice-assistant interface.
// Every module draws from one source of truth.

import { Platform } from 'react-native';
import type { SessionState } from '../hooks/useWoraySession';

/** All session states, used by the dev-only web preview switcher. */
export const DEV_STATES: SessionState[] = ['Idle', 'Connecting', 'Listening', 'AgentSpeaking'];

/**
 * Coherent voice-assistant font family:
 * Prefers Helvetica Neue on iOS, with clean system fallbacks for web/other environments.
 */
export const assistantFontFamily = Platform.select({
  ios: 'Helvetica Neue',
  web: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Roboto, sans-serif',
  default: 'System',
});

/**
 * Returns the voice-assistant spectrum colors across the horizontal waveform.
 * Centers around pure white/pale cyan, flaring out to cyan, violet, and deep indigo.
 */
export function getBarColor(index: number, count: number): string {
  const mid = (count - 1) / 2;
  const dist = Math.abs(index - mid) / mid;
  if (dist < 0.22) {
    return '#FFFFFF';
  } else if (dist < 0.55) {
    return '#5AC8FA'; // cyan
  } else if (dist < 0.8) {
    return '#BF5AF2'; // violet
  } else {
    return '#5E5CE6'; // soft blue / indigo
  }
}
