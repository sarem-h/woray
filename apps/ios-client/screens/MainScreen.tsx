// This file is the ONLY file you need to edit to design the UI.
// Everything else — LiveKit, control WS, Action Button, state machine — is behind useWoraySession.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import type { WoraySession, SessionState } from '../hooks/useWoraySession';

const DEV_STATES: SessionState[] = ['Idle', 'Connecting', 'Listening', 'AgentSpeaking'];

export function MainScreen({ session }: { session: WoraySession }) {
  return (
    <View style={styles.root}>
      {/* DEV-only state switcher, only visible on web */}
      {Platform.OS === 'web' && __DEV__ && (
        <View style={styles.devBar}>
          {DEV_STATES.map((s) => (
            <Pressable
              key={s}
              onPress={() => session.__setPreviewState?.(s)}
              style={styles.devBtn}
            >
              <Text style={styles.devBtnText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.center}>
        <Text style={styles.state}>{session.sessionState}</Text>
        {session.errorMessage ? (
          <Text style={styles.error}>{session.errorMessage}</Text>
        ) : null}
        {session.liveUserText ? (
          <Text style={styles.userLine}>{session.liveUserText}</Text>
        ) : null}
        {session.liveAgentText ? (
          <Text style={styles.agentLine}>{session.liveAgentText}</Text>
        ) : null}
        <Text style={styles.timer}>
          {(session.sessionDurationMs / 1000).toFixed(1)}s
        </Text>
      </View>

      <View style={styles.actions}>
        {session.sessionState === 'Idle' ? (
          <Pressable onPress={session.startSession} style={styles.btn}>
            <Text style={styles.btnText}>Start</Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={session.toggleMic} style={styles.btn}>
              <Text style={styles.btnText}>
                {session.isMicMuted ? 'Unmute' : 'Mute'}
              </Text>
            </Pressable>
            <Pressable onPress={session.endSession} style={styles.btn}>
              <Text style={styles.btnText}>End</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  devBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 6,
    zIndex: 999,
  },
  devBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#222',
    borderRadius: 6,
  },
  devBtnText: { color: '#fff', fontSize: 10 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  state: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  error: { color: '#F87171', fontSize: 14, textAlign: 'center' },
  userLine: { color: 'rgba(255,255,255,0.55)', fontSize: 18, textAlign: 'center' },
  agentLine: { color: '#fff', fontSize: 22, fontWeight: '600', textAlign: 'center' },
  timer: { color: 'rgba(255,255,255,0.3)', fontSize: 12, fontVariant: ['tabular-nums'] },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 40,
  },
  btn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '500' },
});
