// apps/ios-client/components/background/Background.tsx
// Single source of truth for the app backdrop.
// Dark base with a simple gradient glow rising ~100px from the bottom edge.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/** Base background color. Single source of truth — also used by App.tsx to
 *  paint the status-bar / home-indicator safe-area strips. */
export const BASE_COLOR = '#070709';

/** Glow color at the very bottom edge. Also used by App.tsx so the
 *  home-indicator strip continues the glow to the physical screen edge. */
export const GLOW_COLOR = '#67676e83';

/** How far up (in px) the glow rises from the bottom. */
const GLOW_HEIGHT = 130;

export function Background() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Base single color */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE_COLOR }]} />

      {/* Bottom glow: solid at the edge, fading to transparent going up */}
      <LinearGradient
        colors={[GLOW_COLOR, 'rgba(59, 59, 65, 0)']}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={styles.glow}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: GLOW_HEIGHT,
  },
});
