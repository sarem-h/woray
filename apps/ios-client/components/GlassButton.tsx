import React from 'react';
import {
  StyleSheet,
  Text,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { GlassSurface } from './GlassSurface';
import { colors, radius, spacing, typography, springs, motion } from '../theme';

export interface GlassButtonProps {
  label?: string;
  children?: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function GlassButton({
  label,
  children,
  onPress,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
}: GlassButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (disabled) return;
    scale.value = withSpring(motion.pressSquish, springs.press);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handlePressOut = () => {
    if (disabled) return;
    scale.value = withSpring(1, springs.press);
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="button"
      style={style}
    >
      <Animated.View style={animatedStyle}>
        <GlassSurface cornerRadius={radius.pill} style={styles.pillContainer}>
          <Animated.View style={styles.contentRow}>
            {children ?? (
              <Text style={[styles.label, textStyle]}>{label}</Text>
            )}
          </Animated.View>
        </GlassSurface>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    borderRadius: radius.pill,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
