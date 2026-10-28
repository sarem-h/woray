import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { GlassSurface } from './GlassSurface';
import { colors, blur, radius, spacing, typography, springs } from '../theme';

export interface GlassRibbonProps {
  role: 'user' | 'agent';
  text: string;
  persistent?: boolean;
}

export function GlassRibbon({ role, text, persistent = false }: GlassRibbonProps) {
  const shouldReduceMotion = useReducedMotion();
  const translateY = useSharedValue(shouldReduceMotion ? 0 : 20);
  const opacity = useSharedValue(shouldReduceMotion ? 1 : 0);

  useEffect(() => {
    if (!shouldReduceMotion) {
      translateY.value = withSpring(0, springs.ribbon);
      opacity.value = withSpring(1, springs.ribbon);
    } else {
      translateY.value = 0;
      opacity.value = 1;
    }

    if (!persistent) {
      const timer = setTimeout(() => {
        if (!shouldReduceMotion) {
          opacity.value = withTiming(0, { duration: 500 });
          translateY.value = withTiming(10, { duration: 500 });
        } else {
          opacity.value = 0;
        }
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [persistent, shouldReduceMotion, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const isUser = role === 'user';
  const roleDotColor = isUser ? colors.accentListening : colors.accentSpeaking;

  return (
    <Animated.View style={[styles.wrapper, animatedStyle]}>
      <GlassSurface
        cornerRadius={radius.ribbon}
        intensity={blur.ribbon}
        style={styles.surface}
      >
        <View style={styles.contentRow}>
          <View style={[styles.roleIndicator, { backgroundColor: roleDotColor }]}>
            <Text style={styles.roleIcon}>{isUser ? '👤' : '⚡'}</Text>
          </View>
          <Text style={styles.text} numberOfLines={3}>
            {text}
          </Text>
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    maxWidth: '85%',
    alignSelf: 'center',
    marginVertical: 4,
  },
  surface: {
    borderRadius: radius.ribbon,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  roleIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  roleIcon: {
    fontSize: 11,
  },
  text: {
    ...typography.transcript,
    color: colors.textPrimary,
    flexShrink: 1,
    lineHeight: 20,
  },
});
