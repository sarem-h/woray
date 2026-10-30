// apps/ios-client/screens/MainScreen.tsx
// Composition root for the Woray voice-assistant interface.
// All visual subsystems live in focused modules under ../components/* and
// ../theme/typography — this file only wires them to the session state.

import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { WoraySession } from '../hooks/useWoraySession';
import { assistantFontFamily, DEV_STATES } from '../theme/typography';
import { Waveform } from '../components/waveform';
import { ConversationView } from '../components/conversation';
import { SessionControls } from '../components/controls';

export function MainScreen({ session }: { session: WoraySession }) {
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // No extra offset: SafeAreaView already accounts for the status bar.
      keyboardVerticalOffset={0}
    >
      {/* DEV-only state switcher, preserved only on web */}
      {Platform.OS === 'web' && __DEV__ && (
        <View style={styles.devBar}>
          {DEV_STATES.map((s) => (
            <Pressable
              key={s}
              onPress={() => session.__setPreviewState?.(s)}
              style={[styles.devBtn, session.sessionState === s && styles.devBtnActive]}
            >
              <Text
                style={[styles.devBtnText, session.sessionState === s && styles.devBtnTextActive]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Content scroll area */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {/* State: Idle */}
        {session.sessionState === 'Idle' && (
          <View style={styles.centerBlock}>
            <Text style={styles.greetingText}>What can I help you with?</Text>
            {session.errorMessage ? (
              <View style={styles.errorSurface}>
                <Text style={styles.errorText}>{session.errorMessage}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* State: Connecting */}
        {session.sessionState === 'Connecting' && (
          <View style={styles.centerBlock}>
            <Text style={styles.connectingStatusText}>Connecting...</Text>
            {session.errorMessage ? (
              <View style={styles.errorSurface}>
                <Text style={styles.errorText}>{session.errorMessage}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* State: Listening or AgentSpeaking */}
        {(session.sessionState === 'Listening' || session.sessionState === 'AgentSpeaking') && (
          <ConversationView session={session} />
        )}
      </ScrollView>

      {/* Bottom Area: Controls (in-flow flex child so KeyboardAvoidingView lifts it) */}
      <View style={styles.bottomArea}>
        {/* Voice waveform */}
        {/* <Waveform sessionState={session.sessionState} /> */}

        {/* Controls */}
        <View style={styles.controlsRow}>
          <SessionControls session={session} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  devBar: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
    alignSelf: 'center',
    zIndex: 999,
  },
  devBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  devBtnActive: {
    backgroundColor: 'rgba(90, 200, 250, 0.35)',
    borderColor: '#5AC8FA',
  },
  devBtnText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
    fontWeight: '500',
  },
  devBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'web' ? 44 : 34,
    paddingBottom: 24,
    alignItems: 'center',
  },
  centerBlock: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingText: {
    fontFamily: assistantFontFamily,
    fontSize: 24,
    fontWeight: '300',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 32,
  },
  connectingStatusText: {
    fontFamily: assistantFontFamily,
    fontSize: 17,
    fontWeight: '300',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  errorSurface: {
    marginTop: 16,
    backgroundColor: 'rgba(255, 69, 58, 0.14)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    maxWidth: 360,
    alignSelf: 'center',
  },
  errorText: {
    fontFamily: assistantFontFamily,
    color: '#FF6B6B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  bottomArea: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 8,
  },
  controlsRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
