// apps/ios-client/components/controls/SessionControls.tsx
// Bottom control bar with three blocks: plus button, text input, mic button.
// Circle buttons use a fixed diameter so all icons render identical, round circles.

import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import type { WoraySession } from '../../hooks/useWoraySession';

const CIRCLE = 44; // uniform circle diameter for the buttons
const ICON_SIZE = 20;

export function SessionControls({ session }: { session: WoraySession }) {
  return (
    <View style={styles.bar}>
      {/* 1) Plus button */}
      <Pressable
        onPress={() => {
          // TODO: handle "plus" action (attachments / new session / etc.)
        }}
        style={({ pressed }) => [styles.circleBtn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Add"
      >
        <Ionicons name="add" size={24} color="#FFFFFF" />
      </Pressable>

      {/* 2) Input bar */}
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder="Message"
          placeholderTextColor="rgba(255, 255, 255, 0.45)"
          // TODO: wire up value / onChangeText / onSubmitEditing to session
        />
      </View>

      {/* 3) Mic button */}
      <Pressable
        onPress={session.toggleMic}
        style={({ pressed }) => [
          styles.circleBtn,
          session.isMicMuted && styles.circleBtnMuted,
          pressed && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={session.isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
      >
        <FontAwesome
          name={session.isMicMuted ? 'microphone-slash' : 'microphone'}
          size={ICON_SIZE}
          color={session.isMicMuted ? '#FF453A' : '#FFFFFF'}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    gap: 10,
  },
  // Fixed diameter keeps every circle identical and perfectly round regardless
  // of each FontAwesome glyph's intrinsic width.
  circleBtn: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnMuted: {
    backgroundColor: 'rgba(255, 69, 58, 0.18)',
    borderColor: 'rgba(255, 69, 58, 0.45)',
  },
  inputWrap: {
    flex: 1,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  input: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  btnPressed: {
    opacity: 0.7,
  },
});
