// apps/ios-client/components/controls/MicrophoneIcon.tsx
// Crisp vector-style Microphone Icon constructed with pure React Native views.
// Supports active, muted (with strike-through), and custom sizes/colors.

import React from 'react';
import { View } from 'react-native';

export function MicrophoneIcon({
  size = 24,
  color = '#FFFFFF',
  isMuted = false,
}: {
  size?: number;
  color?: string;
  isMuted?: boolean;
}) {
  const activeColor = isMuted ? 'rgba(255, 69, 58, 0.95)' : color;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Microphone capsule */}
      <View
        style={{
          width: size * 0.42,
          height: size * 0.62,
          backgroundColor: activeColor,
          borderRadius: size * 0.21,
        }}
      />
      {/* Cradle */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.2,
          width: size * 0.72,
          height: size * 0.48,
          borderBottomLeftRadius: size * 0.36,
          borderBottomRightRadius: size * 0.36,
          borderWidth: 2,
          borderTopWidth: 0,
          borderColor: activeColor,
          backgroundColor: 'transparent',
        }}
      />
      {/* Stem */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.1,
          width: 2,
          height: size * 0.22,
          backgroundColor: activeColor,
        }}
      />
      {/* Base foot */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.08,
          width: size * 0.48,
          height: 2,
          borderRadius: 1,
          backgroundColor: activeColor,
        }}
      />
      {/* Mute slash indicator */}
      {isMuted && (
        <View
          style={{
            position: 'absolute',
            width: 2,
            height: size * 1.05,
            backgroundColor: '#FF453A',
            transform: [{ rotate: '-45deg' }],
            borderRadius: 1,
          }}
        />
      )}
    </View>
  );
}
