// apps/ios-client/components/controls/CloseIcon.tsx
// Minimal cross/close icon for the End session control.

import React from 'react';
import { View } from 'react-native';

export function CloseIcon({ size = 16, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
          borderRadius: 1,
        }}
      />
    </View>
  );
}
