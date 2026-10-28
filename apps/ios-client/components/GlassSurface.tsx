import React from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, blur, radius } from '../theme';

export interface GlassSurfaceProps {
  children?: React.ReactNode;
  cornerRadius?: number;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}

export function GlassSurface({
  children,
  cornerRadius = radius.card,
  style,
  intensity = blur.panel,
}: GlassSurfaceProps) {
  return (
    <View
      style={[
        styles.shadowWrapper,
        { borderRadius: cornerRadius },
        style,
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.glassBody,
          {
            borderRadius: cornerRadius,
            borderColor: colors.glassBorder,
          },
        ]}
      >
        <BlurView
          intensity={intensity}
          tint={blur.tint}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[colors.specularTop, colors.specularBot, 'transparent']}
          locations={[0, 0.35, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrapper: {
    backgroundColor: 'transparent',
    shadowColor: colors.shadowGlass,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 32,
    shadowOpacity: 1,
  },
  glassBody: {
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: colors.glassSurface,
  },
});
