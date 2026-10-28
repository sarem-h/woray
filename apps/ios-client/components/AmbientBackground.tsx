import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  interpolateColor,
  useReducedMotion,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { colors, blur, springs } from '../theme';

export type VisualState = 'Idle' | 'Connecting' | 'Listening' | 'AgentSpeaking' | 'Error';

export interface AmbientBackgroundProps {
  state: VisualState | string;
  children: React.ReactNode;
}

function getStateIndex(state: string): number {
  switch (state) {
    case 'Idle':
      return 0;
    case 'Connecting':
      return 1;
    case 'Listening':
      return 2;
    case 'AgentSpeaking':
      return 3;
    case 'Error':
      return 4;
    default:
      return 0;
  }
}

export function AmbientBackground({ state, children }: AmbientBackgroundProps) {
  const shouldReduceMotion = useReducedMotion();
  const stateProgress = useSharedValue(getStateIndex(state));
  const driftX = useSharedValue(0);
  const driftY = useSharedValue(0);

  useEffect(() => {
    stateProgress.value = shouldReduceMotion
      ? getStateIndex(state)
      : withSpring(getStateIndex(state), springs.state);
  }, [state, shouldReduceMotion, stateProgress]);

  useEffect(() => {
    if (shouldReduceMotion) {
      driftX.value = 0;
      driftY.value = 0;
      return;
    }

    driftX.value = withRepeat(
      withTiming(30, { duration: 8000 }),
      -1,
      true
    );
    driftY.value = withRepeat(
      withTiming(-20, { duration: 6500 }),
      -1,
      true
    );
  }, [shouldReduceMotion, driftX, driftY]);

  const glowAnimatedStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      stateProgress.value,
      [0, 1, 2, 3, 4],
      [
        colors.accentReady,
        colors.accentConnecting,
        colors.accentListening,
        colors.accentSpeaking,
        colors.accentError,
      ]
    );

    return {
      backgroundColor: color,
      transform: [
        { translateX: driftX.value },
        { translateY: driftY.value },
      ],
    };
  });

  return (
    <View style={styles.container}>
      {/* 3-stop background gradient */}
      <LinearGradient
        colors={[colors.bgTop, colors.bgMid, colors.bgBottom]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Reactive ambient glow disc */}
      <View style={styles.glowAnchor} pointerEvents="none">
        <Animated.View style={[styles.glowCircle, glowAnimatedStyle]} />
        <BlurView
          intensity={blur.background}
          tint={blur.tint}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Foreground content */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgTop,
  },
  glowAnchor: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glowCircle: {
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.32,
  },
  content: {
    flex: 1,
  },
});
