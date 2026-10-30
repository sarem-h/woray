// apps/ios-client/components/conversation/TranscriptTurn.tsx
// A single conversational turn rendered in identical voice-assistant typography.
// User queries appear quoted with a "tap to edit" affordance; agent responses
// are plain, or wrapped in a frosted surface when they run long (>160 chars).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { TranscriptItem } from '../../hooks/useWoraySession';
import { assistantFontFamily } from '../../theme/typography';

const LONG_RESPONSE_THRESHOLD = 160;

/** Shared agent-response body: frosted surface when long, plain text otherwise. */
function AgentResponseBody({ text }: { text: string }) {
  if (text.length > LONG_RESPONSE_THRESHOLD) {
    return (
      <View style={styles.agentResponseSurface}>
        <Text style={styles.agentResponseText}>{text}</Text>
      </View>
    );
  }
  return <Text style={styles.agentResponseText}>{text}</Text>;
}

/** A historical transcript item (user or agent). */
export function TranscriptTurn({ item }: { item: TranscriptItem }) {
  return (
    <View style={styles.turnBlock}>
      {item.role === 'user' ? (
        <View style={styles.userQueryContainer}>
          <Text style={styles.userQueryText}>“{item.text}”</Text>
          <Text style={styles.tapToEditText}>tap to edit</Text>
        </View>
      ) : (
        <View style={styles.agentResponseContainer}>
          <AgentResponseBody text={item.text} />
        </View>
      )}
    </View>
  );
}

/** The live, in-progress user utterance (quoted + "tap to edit"). */
export function LiveUserTurn({ text }: { text: string }) {
  return (
    <View style={styles.userQueryContainer}>
      <Text style={styles.userQueryText}>“{text}”</Text>
      <Text style={styles.tapToEditText}>tap to edit</Text>
    </View>
  );
}

/** The live, in-progress agent response. */
export function LiveAgentTurn({ text }: { text: string }) {
  return (
    <View style={styles.agentResponseContainer}>
      <AgentResponseBody text={text} />
    </View>
  );
}

const styles = StyleSheet.create({
  turnBlock: {
    width: '100%',
    alignItems: 'center',
  },
  userQueryContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  userQueryText: {
    fontFamily: assistantFontFamily,
    fontSize: 17,
    fontWeight: '300',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  tapToEditText: {
    fontFamily: assistantFontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.45)',
    textAlign: 'center',
    marginTop: 3,
    letterSpacing: 0.1,
  },
  agentResponseContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
  },
  agentResponseText: {
    fontFamily: assistantFontFamily,
    fontSize: 16,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 22,
  },
  agentResponseSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
