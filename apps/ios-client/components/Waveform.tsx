import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, motion } from '../theme';

export interface WaveformProps {
  amplitude?: number; // 0 to 1
  colorPair?: readonly [string, string];
  barCount?: number;
  maxHeight?: number;
}

interface WaveBarProps {
  index: number;
  barCount: number;
  amplitude: number;
  colorPair: readonly [string, string];
  maxHeight: number;
}

function WaveBar({
  index,
  barCount,
  amplitude,
  colorPair,
  maxHeight,
}: WaveBarProps) {
  const shouldReduceMotion = useReducedMotion();
  const anim = useSharedValue(0.2);
  const amp = useSharedValue(amplitude);

  useEffect(() => {
    amp.value = withTiming(amplitude, { duration: 120 });
  }, [amplitude, amp]);

  useEffect(() => {
    if (shouldReduceMotion) {
      anim.value = 0.5;
      return;
    }

    const staggerDelay = (index % 8) * motion.waveBarStagger;
    const timeout = setTimeout(() => {
      anim.value = withRepeat(
        withTiming(1, { duration: motion.waveBarDuration }),
        -1,
        true
      );
    }, staggerDelay);

    return () => clearTimeout(timeout);
  }, [shouldReduceMotion, index, anim]);

  const minHeight = 4;
  const animatedStyle = useAnimatedStyle(() => {
    const currentAmp = Math.max(0.08, Math.min(1, amp.value));
    // Bell curve scaling across bar spectrum
    const bell = Math.sin(((index + 1) / (barCount + 1)) * Math.PI);
    const targetMax = Math.max(
      minHeight + 2,
      currentAmp * maxHeight * (0.35 + 0.65 * bell)
    );
    const barHeight = minHeight + (targetMax - minHeight) * anim.value;

    return {
      height: barHeight,
    };
  });

  return (
    <Animated.View style={[styles.bar, animatedStyle]}>
      <LinearGradient
        colors={[colorPair[0], colorPair[1]]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function Waveform({
  amplitude = 0.1,
  colorPair = colors.gradientListening,
  barCount = 24,
  maxHeight = 36,
}: WaveformProps) {
  const bars = Array.from({ length: barCount }, (_, i) => i);

  return (
    <View style={styles.container}>
      {bars.map((i) => (
        <WaveBar
          key={i}
          index={i}
          barCount={barCount}
          amplitude={amplitude}
          colorPair={colorPair}
          maxHeight={maxHeight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    width: '100%',
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
});
