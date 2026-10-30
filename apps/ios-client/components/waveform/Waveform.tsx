// apps/ios-client/components/waveform/Waveform.tsx
// Voice-assistant horizontal audio waveform.
// Thin, horizontally stretched, with state-dependent amplitude & rhythm.

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Platform } from 'react-native';
import type { SessionState } from '../../hooks/useWoraySession';
import { getBarColor } from '../../theme/typography';

const BAR_COUNT = 35;
const CENTER_INDEX = 17;

export function Waveform({ sessionState }: { sessionState: SessionState }) {
  const animValues = useRef<Animated.Value[]>(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.06))
  ).current;

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];
    const useNative = Platform.OS !== 'web';

    animValues.forEach((anim, i) => {
      const dist = Math.abs(i - CENTER_INDEX) / CENTER_INDEX;
      const envelope = Math.pow(Math.cos(dist * (Math.PI / 2)), 1.75);

      let minScale = 0.05;
      let maxScale = 0.14;
      let dur = 2200;
      let delay = 0;

      if (sessionState === 'Idle') {
        minScale = 0.05;
        maxScale = minScale + envelope * 0.09;
        dur = 2200;
        delay = (i % 6) * 50;
      } else if (sessionState === 'Connecting') {
        minScale = 0.06;
        maxScale = minScale + envelope * 0.38;
        dur = 1300;
        delay = (i / BAR_COUNT) * dur;
      } else if (sessionState === 'Listening') {
        minScale = 0.08;
        const staggerMod = ((i * 7) % 11) / 11;
        maxScale = minScale + envelope * (0.44 + staggerMod * 0.36);
        dur = 700;
        delay = ((i * 4) % 9) * 60;
      } else if (sessionState === 'AgentSpeaking') {
        minScale = 0.10;
        const harmonicMod = Math.abs(Math.sin(i * 0.75));
        maxScale = minScale + envelope * (0.65 + harmonicMod * 0.65);
        dur = 380 + ((i * 13) % 5) * 30;
        delay = ((i * 5) % 8) * 35;
      }

      const t = setTimeout(() => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: maxScale,
              duration: dur / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: useNative,
            }),
            Animated.timing(anim, {
              toValue: minScale,
              duration: dur / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: useNative,
            }),
          ])
        );
        loops.push(loop);
        loop.start();
      }, delay);
      timeouts.push(t);
    });

    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      loops.forEach((l) => l.stop());
      animValues.forEach((v) => v.stopAnimation());
    };
  }, [sessionState, animValues]);

  return (
    <View style={styles.waveformContainer}>
      {/* Thin horizontal glowing baseline */}
      <View style={styles.waveBaseline} />
      {/* Symmetrical bar spectrum */}
      <View style={styles.waveBarsRow}>
        {animValues.map((anim, i) => {
          const color = getBarColor(i, BAR_COUNT);
          return (
            <Animated.View
              key={i}
              style={[
                styles.waveBar,
                {
                  backgroundColor: color,
                  shadowColor: color,
                  transform: [{ scaleY: anim }],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  waveformContainer: {
    width: '84%',
    maxWidth: 320,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 12,
  },
  waveBaseline: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    shadowColor: '#5AC8FA',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 4,
    shadowOpacity: 0.5,
  },
  waveBarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  waveBar: {
    width: 3,
    height: 42,
    borderRadius: 1.5,
    marginHorizontal: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 5,
    shadowOpacity: 0.65,
  },
});
