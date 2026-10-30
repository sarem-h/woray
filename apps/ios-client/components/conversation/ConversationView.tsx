// apps/ios-client/components/conversation/ConversationView.tsx
// Renders the conversation for the active Listening / AgentSpeaking states:
// historical turns, the live user utterance, and the live agent response —
// plus a restrained mid-session error notice.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { WoraySession } from '../../hooks/useWoraySession';
import { assistantFontFamily } from '../../theme/typography';
import { TranscriptTurn, LiveUserTurn, LiveAgentTurn } from './TranscriptTurn';

export function ConversationView({ session }: { session: WoraySession }) {
  const activeUserQuery = session.liveUserText.trim();
  const activeAgentResponse = session.liveAgentText.trim();

  // Deduplicate past transcript items to prevent repeated text
  const previousTranscripts = session.transcripts.filter((item) => {
    const trimmed = item.text.trim();
    if (!trimmed) return false;
    if (activeUserQuery && trimmed === activeUserQuery) return false;
    if (activeAgentResponse && trimmed === activeAgentResponse) return false;
    return true;
  });

  return (
    <View style={styles.conversationBlock}>
      {/* Conversation history: rendered in identical voice-assistant typography */}
      {previousTranscripts.map((item) => (
        <TranscriptTurn key={item.id} item={item} />
      ))}

      {/* Active live user utterance */}
      {activeUserQuery ? (
        <LiveUserTurn text={activeUserQuery} />
      ) : session.sessionState === 'Listening' && previousTranscripts.length === 0 ? (
        <View style={styles.centerBlock}>
          <Text style={styles.greetingText}>What can I help you with?</Text>
        </View>
      ) : null}

      {/* Active live assistant response directly beneath recognized query */}
      {activeAgentResponse ? <LiveAgentTurn text={activeAgentResponse} /> : null}

      {/* Restrained error notice if an error occurs mid-session */}
      {session.errorMessage ? (
        <View style={styles.errorSurface}>
          <Text style={styles.errorText}>{session.errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  conversationBlock: {
    width: '100%',
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
});
