import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  Modal,
  Animated,
  Easing,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAppIntents, removePendingInvocationAsync } from 'expo-app-intents';
import {
  LiveKitRoom,
  AudioSession,
  useVoiceAssistant,
  useLocalParticipant,
  useRoomContext,
  useConnectionState,
} from '@livekit/react-native';
import { ConnectionState } from 'livekit-client';

export type SessionState = 'Idle' | 'Connecting' | 'Listening' | 'AgentSpeaking';
export type TriggerSource = 'action_button' | 'deep_link' | 'manual';

interface SessionTokenResponse {
  token: string;
  wsUrl: string;
  room?: string;
  identity?: string;
}

// Default fallback host - customize via in-app settings modal
const DEFAULT_BACKEND_HOST = 'http://localhost:3001';

/**
 * VoiceAssistantSessionView: Active LiveKit Room inner component.
 * Tracks local participant mic activity, agent voice assistant state,
 * and renders reactive visual feedback with barge-in cues.
 */
function VoiceAssistantSessionView({
  triggerSource,
  onDisconnect,
  onStateChange,
}: {
  triggerSource: TriggerSource;
  onDisconnect: () => void;
  onStateChange: (state: SessionState) => void;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();

  const [sessionSeconds, setSessionSeconds] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  // Determine active visual state
  const isAgentSpeaking =
    voiceAssistant?.state === 'speaking' ||
    (voiceAssistant?.agent?.isSpeaking ?? false);

  const isLocalSpeaking = localParticipant?.isSpeaking ?? false;

  let currentVisualState: SessionState = 'Listening';
  if (connectionState === ConnectionState.Connecting) {
    currentVisualState = 'Connecting';
  } else if (isAgentSpeaking) {
    currentVisualState = 'AgentSpeaking';
  } else {
    currentVisualState = 'Listening';
  }

  // Notify parent of state changes
  useEffect(() => {
    onStateChange(currentVisualState);
  }, [currentVisualState, onStateChange]);

  // Session duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Reactive wave animations
  useEffect(() => {
    let anim: Animated.CompositeAnimation;
    if (currentVisualState === 'AgentSpeaking') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.35,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.95,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    } else if (currentVisualState === 'Listening') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: isLocalSpeaking ? 1.25 : 1.1,
            duration: isLocalSpeaking ? 300 : 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: isLocalSpeaking ? 300 : 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    } else {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 0.8,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
    }
    anim.start();
    return () => anim.stop();
  }, [currentVisualState, isLocalSpeaking, pulseAnim, glowAnim]);

  // Toggle microphone
  const toggleMicrophone = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (room && localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <View style={styles.sessionContainer}>
      {/* Session Header Badges */}
      <View style={styles.sessionHeader}>
        <View style={styles.badgeContainer}>
          <View
            style={[
              styles.statusDot,
              currentVisualState === 'AgentSpeaking'
                ? styles.dotSpeaking
                : currentVisualState === 'Listening'
                ? styles.dotListening
                : styles.dotConnecting,
            ]}
          />
          <Text style={styles.sessionStateText}>{currentVisualState}</Text>
        </View>

        <View style={styles.timerBadge}>
          <Text style={styles.timerText}>{formatTimer(sessionSeconds)}</Text>
        </View>
      </View>

      {/* Trigger info */}
      <View style={styles.triggerBadge}>
        <Text style={styles.triggerBadgeText}>
          {triggerSource === 'action_button'
            ? '⚡ Triggered by Action Button'
            : triggerSource === 'deep_link'
            ? '🔗 Triggered by Deep Link'
            : '👆 Manual Session'}
        </Text>
      </View>

      {/* Pulsing Visual Orb */}
      <View style={styles.orbCenterContainer}>
        {/* Outer Ring */}
        <Animated.View
          style={[
            styles.outerOrbRing,
            currentVisualState === 'AgentSpeaking'
              ? styles.ringAgent
              : styles.ringUser,
            {
              transform: [{ scale: pulseAnim }],
              opacity: currentVisualState === 'AgentSpeaking' ? 0.6 : 0.35,
            },
          ]}
        />
        {/* Middle Ring */}
        <Animated.View
          style={[
            styles.middleOrbRing,
            currentVisualState === 'AgentSpeaking'
              ? styles.ringAgent
              : styles.ringUser,
            {
              transform: [{ scale: pulseAnim }],
              opacity: currentVisualState === 'AgentSpeaking' ? 0.8 : 0.5,
            },
          ]}
        />
        {/* Core Orb */}
        <View
          style={[
            styles.coreOrb,
            currentVisualState === 'AgentSpeaking'
              ? styles.coreAgent
              : styles.coreUser,
          ]}
        >
          <Text style={styles.coreOrbIcon}>
            {currentVisualState === 'AgentSpeaking' ? '🔊' : '🎙️'}
          </Text>
        </View>
      </View>

      {/* Real-time Status Message */}
      <View style={styles.statusDescriptionBox}>
        <Text style={styles.statusTitle}>
          {currentVisualState === 'AgentSpeaking'
            ? 'VoiceOS is speaking...'
            : isLocalSpeaking
            ? 'Transmitting speech...'
            : 'Listening... (Speak naturally)'}
        </Text>
        <Text style={styles.statusSubtitle}>
          {currentVisualState === 'AgentSpeaking'
            ? 'Silero VAD active • Barge in anytime to interrupt'
            : 'Opus 48kHz Full-Duplex WebRTC stream active'}
        </Text>
      </View>

      {/* In-Session Action Bar */}
      <View style={styles.sessionControls}>
        <TouchableOpacity
          style={[
            styles.controlCircleButton,
            !isMicrophoneEnabled && styles.micMutedButton,
          ]}
          onPress={toggleMicrophone}
          accessibilityLabel="Toggle microphone"
        >
          <Text style={styles.controlCircleIcon}>
            {isMicrophoneEnabled ? '🎙️' : '🔇'}
          </Text>
          <Text style={styles.controlCircleLabel}>
            {isMicrophoneEnabled ? 'Mute' : 'Unmuted'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.endSessionCircleButton}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            onDisconnect();
          }}
          accessibilityLabel="End voice session"
        >
          <Text style={styles.endSessionIcon}>✕</Text>
          <Text style={styles.endSessionLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Root VoiceOS Application Component.
 */
export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('Idle');
  const [sessionInfo, setSessionInfo] = useState<SessionTokenResponse | null>(null);
  const [triggerSource, setTriggerSource] = useState<TriggerSource>('manual');
  const [backendHost, setBackendHost] = useState<string>(DEFAULT_BACKEND_HOST);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [hostInput, setHostInput] = useState<string>(DEFAULT_BACKEND_HOST);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initialUrl = Linking.useURL();
  const isStartingRef = useRef(false);

  // Manage Native Audio Session and Screen Keep Awake during active call
  const startNativeAudio = useCallback(async () => {
    try {
      await AudioSession.startAudioSession();
      await activateKeepAwakeAsync();
    } catch (e) {
      console.warn('[VoiceOS] Failed to start native AudioSession:', e);
    }
  }, []);

  const stopNativeAudio = useCallback(async () => {
    try {
      await AudioSession.stopAudioSession();
      await deactivateKeepAwake();
    } catch (e) {
      console.warn('[VoiceOS] Failed to stop native AudioSession:', e);
    }
  }, []);

  // Fetch token and initiate LiveKit WebRTC connection
  const initiateSession = useCallback(
    async (source: TriggerSource) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      setErrorMessage(null);
      setTriggerSource(source);
      setSessionState('Connecting');

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await startNativeAudio();

        const endpoint = `${backendHost.replace(/\/$/, '')}/api/session/token`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            room: 'action-button-room',
            identity: 'iphone-17-client',
            trigger: source,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Token fetch failed (${res.status}): ${errText}`);
        }

        const data: SessionTokenResponse = await res.json();
        if (!data.token || !data.wsUrl) {
          throw new Error('Malformed token response from voice backend');
        }

        setSessionInfo(data);
      } catch (err: any) {
        console.error('[VoiceOS] Connection initiation error:', err);
        setErrorMessage(err.message || 'Failed to connect to VoiceOS backend');
        setSessionState('Idle');
        setSessionInfo(null);
        await stopNativeAudio();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        isStartingRef.current = false;
      }
    },
    [backendHost, startNativeAudio, stopNativeAudio]
  );

  // Disconnect session
  const handleDisconnect = useCallback(async () => {
    setSessionInfo(null);
    setSessionState('Idle');
    await stopNativeAudio();
  }, [stopNativeAudio]);

  // 1. Listen to Native App Intents (iPhone 17 Action Button)
  useAppIntents(async (pendingIntents) => {
    if (!pendingIntents || pendingIntents.length === 0) return;

    for (const invocation of pendingIntents) {
      if (
        invocation.name === 'startVoiceSession' ||
        invocation.name === 'StartVoiceSessionIntent'
      ) {
        await initiateSession('action_button');
      }
      try {
        await removePendingInvocationAsync(invocation.id);
      } catch (e) {
        console.warn('[VoiceOS] removePendingInvocationAsync warning:', e);
      }
    }
  });

  // 2. Listen to Deep Linking (voiceos://start or custom URL schemes)
  useEffect(() => {
    if (initialUrl && initialUrl.includes('start')) {
      initiateSession('deep_link');
    }

    const sub = Linking.addEventListener('url', (event) => {
      if (event.url && event.url.includes('start')) {
        initiateSession('deep_link');
      }
    });

    return () => sub.remove();
  }, [initialUrl, initiateSession]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />

      {/* Top Navigation Bar */}
      <View style={styles.navBar}>
        <View style={styles.navTitleContainer}>
          <Text style={styles.brandTitle}>VOICE<Text style={styles.brandAccent}>OS</Text></Text>
          <Text style={styles.brandSubtitle}>Action Button Real-Time Assistant</Text>
        </View>

        <TouchableOpacity
          style={styles.settingsIconButton}
          onPress={() => {
            setHostInput(backendHost);
            setSettingsModalVisible(true);
          }}
          accessibilityLabel="Open settings"
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <View style={styles.contentContainer}>
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
          </View>
        )}

        {sessionInfo ? (
          /* LiveKit Audio Session Room */
          <LiveKitRoom
            serverUrl={sessionInfo.wsUrl}
            token={sessionInfo.token}
            connect={true}
            audio={true}
            video={false}
            onDisconnected={handleDisconnect}
            onError={(err) => {
              console.error('[VoiceOS] LiveKit room error:', err);
              setErrorMessage(err.message);
              handleDisconnect();
            }}
            options={{
              audioCaptureDefaults: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            }}
          >
            <VoiceAssistantSessionView
              triggerSource={triggerSource}
              onDisconnect={handleDisconnect}
              onStateChange={setSessionState}
            />
          </LiveKitRoom>
        ) : (
          /* Idle Standby UI */
          <View style={styles.idleContainer}>
            <View style={styles.idleOrbHalo}>
              <View style={styles.idleOrbCore}>
                <Text style={styles.idleOrbIcon}>⚡</Text>
              </View>
            </View>

            <View style={styles.idleCopy}>
              <Text style={styles.idleHeader}>Standby Mode</Text>
              <Text style={styles.idleSubheader}>
                Hold the <Text style={styles.highlightText}>Action Button</Text> on your iPhone 17 or tap below to start.
              </Text>
            </View>

            {/* Quick manual trigger button */}
            <TouchableOpacity
              style={styles.manualStartButton}
              onPress={() => initiateSession('manual')}
              disabled={sessionState === 'Connecting'}
              activeOpacity={0.8}
            >
              {sessionState === 'Connecting' ? (
                <ActivityIndicator color="#09090b" />
              ) : (
                <>
                  <Text style={styles.manualButtonIcon}>🎙️</Text>
                  <Text style={styles.manualButtonText}>Start Voice Session</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Backend connection pill */}
            <View style={styles.backendStatusPill}>
              <View style={styles.backendDot} />
              <Text style={styles.backendStatusText} numberOfLines={1}>
                Target: {backendHost}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Backend Host Config Modal */}
      <Modal
        visible={settingsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Backend Settings</Text>
            <Text style={styles.modalDescription}>
              Set the IP address or host of your voice-backend server (e.g. your PC's LAN IP when testing on a physical iPhone).
            </Text>

            <TextInput
              style={styles.hostTextInput}
              value={hostInput}
              onChangeText={setHostInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.1.100:3001"
              placeholderTextColor="#71717a"
            />

            <View style={styles.modalButtonGroup}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setSettingsModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={() => {
                  setBackendHost(hostInput.trim());
                  setSettingsModalVisible(false);
                }}
              >
                <Text style={styles.modalSaveText}>Save Host</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  navTitleContainer: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fafafa',
    letterSpacing: 1.2,
  },
  brandAccent: {
    color: '#06b6d4',
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  settingsIconButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#18181b',
  },
  settingsIcon: {
    fontSize: 18,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '500',
  },
  /* Idle styles */
  idleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  idleOrbHalo: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
    marginBottom: 32,
  },
  idleOrbCore: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#18181b',
    borderWidth: 2,
    borderColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#06b6d4',
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
  idleOrbIcon: {
    fontSize: 32,
  },
  idleCopy: {
    alignItems: 'center',
    marginBottom: 36,
  },
  idleHeader: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f4f4f5',
    marginBottom: 8,
  },
  idleSubheader: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  highlightText: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  manualStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#06b6d4',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    shadowColor: '#06b6d4',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    marginBottom: 24,
  },
  manualButtonIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  manualButtonText: {
    color: '#09090b',
    fontSize: 16,
    fontWeight: '700',
  },
  backendStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    maxWidth: '85%',
  },
  backendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 8,
  },
  backendStatusText: {
    fontSize: 11,
    color: '#71717a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  /* Active Session styles */
  sessionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
  },
  sessionHeader: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotSpeaking: {
    backgroundColor: '#a855f7',
  },
  dotListening: {
    backgroundColor: '#10b981',
  },
  dotConnecting: {
    backgroundColor: '#f59e0b',
  },
  sessionStateText: {
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '600',
  },
  timerBadge: {
    backgroundColor: '#18181b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  timerText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  triggerBadge: {
    marginTop: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  triggerBadgeText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '500',
  },
  orbCenterContainer: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  outerOrbRing: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 1.5,
  },
  middleOrbRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
  },
  ringAgent: {
    borderColor: '#c084fc',
    backgroundColor: 'rgba(192, 132, 252, 0.08)',
  },
  ringUser: {
    borderColor: '#34d399',
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
  },
  coreOrb: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.6,
    shadowRadius: 20,
  },
  coreAgent: {
    backgroundColor: '#7e22ce',
    shadowColor: '#a855f7',
  },
  coreUser: {
    backgroundColor: '#059669',
    shadowColor: '#10b981',
  },
  coreOrbIcon: {
    fontSize: 44,
  },
  statusDescriptionBox: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f4f4f5',
    marginBottom: 6,
    textAlign: 'center',
  },
  statusSubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 18,
  },
  sessionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 10,
  },
  controlCircleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  micMutedButton: {
    backgroundColor: '#ef4444',
    borderColor: '#dc2626',
  },
  controlCircleIcon: {
    fontSize: 22,
  },
  controlCircleLabel: {
    color: '#e4e4e7',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  endSessionCircleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ef4444',
  },
  endSessionIcon: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  endSessionLabel: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  /* Settings Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fafafa',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 18,
    marginBottom: 16,
  },
  hostTextInput: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f4f4f5',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 20,
  },
  modalButtonGroup: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  modalCancelText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#06b6d4',
  },
  modalSaveText: {
    color: '#09090b',
    fontSize: 14,
    fontWeight: '700',
  },
});
