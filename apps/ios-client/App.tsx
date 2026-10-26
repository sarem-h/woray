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
  Settings,
  AppState,
  type AppStateStatus,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  LiveKitRoom,
  AudioSession,
  useVoiceAssistant,
  useLocalParticipant,
  useRoomContext,
  useConnectionState,
} from '@livekit/react-native';
import {
  ConnectionState,
  RoomEvent,
  type TranscriptionSegment,
  type Participant,
} from 'livekit-client';
import runtimeConfig from './runtime-config.json';

export type SessionState = 'Idle' | 'Connecting' | 'Listening' | 'AgentSpeaking';
export type TriggerSource = 'action_button' | 'deep_link' | 'manual';

interface SessionTokenResponse {
  token: string;
  wsUrl: string;
  room?: string;
  identity?: string;
}

/**
 * Resolves the initial backend host prioritizing:
 * 1. Active Cloudflare tunnel URL in runtime-config.json (bypasses enterprise Wi-Fi blocks)
 * 2. Saved host in iOS Settings (persisted across restarts)
 * 3. Default fallback in runtime-config or localhost:3001
 */
function resolveInitialBackendHost(): string {
  const runtimeHost = (runtimeConfig?.backendHost || '').trim();
  if (runtimeHost.includes('.trycloudflare.com')) {
    return runtimeHost;
  }
  if (Platform.OS === 'ios') {
    const saved = Settings.get('woray_backend_host');
    if (typeof saved === 'string' && saved.trim().length > 0) {
      return saved.trim();
    }
  }
  return runtimeHost || 'http://localhost:3001';
}

const DEFAULT_BACKEND_HOST = resolveInitialBackendHost();

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
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [agentTranscript, setAgentTranscript] = useState<string>('');
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  // Real-time live speech & agent transcription listener
  useEffect(() => {
    if (!room) return;

    const handleTranscription = (
      segments: TranscriptionSegment[],
      participant?: Participant
    ) => {
      const text = segments.map((s) => s.text).join(' ').trim();
      if (!text) return;

      if (participant?.isLocal) {
        setUserTranscript(text);
      } else {
        setAgentTranscript(text);
      }
    };

    room.on(RoomEvent.TranscriptionReceived, handleTranscription);
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handleTranscription);
    };
  }, [room]);

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
            ? 'Woray is speaking...'
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

      {/* Sleek Translucent Glassmorphic Live Caption Card */}
      <View style={styles.captionCard}>
        <View style={styles.captionSpeakerSection}>
          <View style={styles.captionHeaderRow}>
            <View style={[styles.speakerDot, styles.speakerUserDot]} />
            <Text style={styles.captionSpeakerTag}>You</Text>
          </View>
          <Text
            style={[
              styles.captionText,
              !userTranscript && styles.captionPlaceholder,
            ]}
            numberOfLines={2}
          >
            {userTranscript || (isLocalSpeaking ? 'Transcribing speech...' : 'Listening...')}
          </Text>
        </View>

        <View style={styles.captionDivider} />

        <View style={styles.captionSpeakerSection}>
          <View style={styles.captionHeaderRow}>
            <View style={[styles.speakerDot, styles.speakerAgentDot]} />
            <Text style={styles.captionSpeakerTag}>Woray</Text>
          </View>
          <Text
            style={[
              styles.captionText,
              !agentTranscript && styles.captionPlaceholder,
            ]}
            numberOfLines={3}
          >
            {agentTranscript || (isAgentSpeaking ? 'Woray responding...' : 'Ready')}
          </Text>
        </View>
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
 * Root Woray Application Component.
 */
export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('Idle');
  const [sessionInfo, setSessionInfo] = useState<SessionTokenResponse | null>(null);
  const [triggerSource, setTriggerSource] = useState<TriggerSource>('manual');
  const [backendHost, setBackendHost] = useState<string>(DEFAULT_BACKEND_HOST);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [hostInput, setHostInput] = useState<string>(DEFAULT_BACKEND_HOST);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Action Button Invocation HUD Telemetry & State
  const [handoffLatency, setHandoffLatency] = useState<number | null>(null);
  const [hudVisible, setHudVisible] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(1);
  const hudSlideAnim = useRef(new Animated.Value(-140)).current;
  const lastConsumedTsRef = useRef<number>(0);

  const initialUrl = Linking.useURL();
  const isStartingRef = useRef(false);
  const controlWsRef = useRef<WebSocket | null>(null);

  // Maintain lightweight WebSocket connection to /ws/control for pre-warming & telemetry
  useEffect(() => {
    if (!backendHost) return;

    let ws: WebSocket | null = null;
    let isCancelled = false;

    try {
      const wsUrl =
        backendHost
          .replace(/^http:\/\//i, 'ws://')
          .replace(/^https:\/\//i, 'wss://')
          .replace(/\/$/, '') + '/ws/control';

      console.log('[Woray Client] Connecting to control WebSocket:', wsUrl);
      ws = new WebSocket(wsUrl);
      controlWsRef.current = ws;

      ws.onopen = () => {
        if (!isCancelled) {
          console.log('[Woray Client] Control WebSocket connected');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Woray Client] Control message:', data);
        } catch {
          // ignore
        }
      };

      ws.onerror = (err) => {
        console.warn('[Woray Client] Control WebSocket notice:', err);
      };

      ws.onclose = () => {
        if (!isCancelled) {
          console.log('[Woray Client] Control WebSocket closed');
        }
      };
    } catch (e) {
      console.warn('[Woray Client] Failed to initialize control WebSocket:', e);
    }

    return () => {
      isCancelled = true;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [backendHost]);

  // Manage Native Audio Session and Screen Keep Awake during active call
  const startNativeAudio = useCallback(async () => {
    try {
      await AudioSession.startAudioSession();
      await activateKeepAwakeAsync();
    } catch (e) {
      console.warn('[Woray] Failed to start native AudioSession:', e);
    }
  }, []);

  const stopNativeAudio = useCallback(async () => {
    try {
      await AudioSession.stopAudioSession();
      await deactivateKeepAwake();
    } catch (e) {
      console.warn('[Woray] Failed to stop native AudioSession:', e);
    }
  }, []);

  // Fetch token and initiate LiveKit WebRTC connection with dynamic room isolation & latency telemetry
  const initiateSession = useCallback(
    async (source: TriggerSource, handoffLatencyMs?: number) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      setErrorMessage(null);
      setTriggerSource(source);
      setSessionState('Connecting');
      setHandoffLatency(handoffLatencyMs ?? null);
      setPipelineStep(1); // 1: Hardware Intent / User Invocation Captured
      setHudVisible(true);
      setHudCollapsed(false);

      Animated.spring(hudSlideAnim, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }).start();

      // Unique session room ID on every call so consecutive calls never collide
      const dynamicRoom = `woray-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      // Send action_button_press pre-warm notification to control WebSocket if open
      try {
        if (controlWsRef.current && controlWsRef.current.readyState === WebSocket.OPEN) {
          controlWsRef.current.send(
            JSON.stringify({
              type: 'action_button_press',
              timestamp: Date.now(),
              room: dynamicRoom,
              trigger: source,
              handoffLatencyMs: handoffLatencyMs ?? null,
            })
          );
        }
      } catch (wsErr) {
        console.warn('[Woray] Non-fatal control WS send notice:', wsErr);
      }

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await startNativeAudio();
        setPipelineStep(2); // 2: AudioSession & AEC Armed

        setPipelineStep(3); // 3: Joining WebRTC Room...
        const endpoint = `${backendHost.replace(/\/$/, '')}/api/session/token`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            room: dynamicRoom,
            identity: 'auto',
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
        console.error('[Woray] Connection initiation error:', err);
        setErrorMessage(err.message || 'Failed to connect to Woray backend');
        setSessionState('Idle');
        setSessionInfo(null);
        await stopNativeAudio();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        isStartingRef.current = false;
      }
    },
    [backendHost, startNativeAudio, stopNativeAudio, hudSlideAnim]
  );

  // Monitor session state for HUD card auto-collapse & dismiss
  useEffect(() => {
    if (sessionState === 'Listening' || sessionState === 'AgentSpeaking') {
      setPipelineStep(4); // 4: LiveKit 48kHz Stream Active
      const timer = setTimeout(() => {
        setHudCollapsed(true);
      }, 1500);
      return () => clearTimeout(timer);
    } else if (sessionState === 'Idle') {
      setHudCollapsed(false);
      Animated.timing(hudSlideAnim, {
        toValue: -140,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setHudVisible(false));
    }
  }, [sessionState, hudSlideAnim]);

  // Deterministic Native Trigger Detection via NSUserDefaults / Settings API
  const checkNativeActionButtonTrigger = useCallback(() => {
    if (Platform.OS !== 'ios') return;
    try {
      const rawTs = Number(Settings.get('woray_action_button_timestamp')) || 0;
      const nowSec = Date.now() / 1000;
      if (rawTs > 0 && rawTs !== lastConsumedTsRef.current && nowSec - rawTs < 20) {
        lastConsumedTsRef.current = rawTs;
        Settings.set({ woray_action_button_timestamp: 0 });
        const handoffLatencyMs = Math.max(1, Math.round((nowSec - rawTs) * 1000));
        console.log(
          `[Woray Native] Action Button hardware trigger detected! Handoff latency: ${handoffLatencyMs}ms`
        );
        initiateSession('action_button', handoffLatencyMs);
      }
    } catch (e) {
      console.warn('[Woray Native] Error checking action button timestamp:', e);
    }
  }, [initiateSession]);

  useEffect(() => {
    // Check on mount
    checkNativeActionButtonTrigger();

    // Check when AppState transitions to 'active'
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkNativeActionButtonTrigger();
        const t1 = setTimeout(checkNativeActionButtonTrigger, 150);
        const t2 = setTimeout(checkNativeActionButtonTrigger, 400);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkNativeActionButtonTrigger]);

  // Disconnect session
  const handleDisconnect = useCallback(async () => {
    setSessionInfo(null);
    setSessionState('Idle');
    await stopNativeAudio();
  }, [stopNativeAudio]);

  // Listen to Deep Linking (woray://start?trigger=action_button or custom URL schemes)
  const handleUrl = useCallback(
    (url: string | null) => {
      if (!url) return;
      if (url.includes('trigger=action_button')) {
        initiateSession('action_button');
      } else if (url.includes('start')) {
        initiateSession('deep_link');
      }
    },
    [initiateSession]
  );

  useEffect(() => {
    handleUrl(initialUrl);

    const sub = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, [initialUrl, handleUrl]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />

      {/* Action Button Invocation HUD Card */}
      {hudVisible && (
        <Animated.View
          style={[
            styles.hudContainer,
            { transform: [{ translateY: hudSlideAnim }] },
          ]}
        >
          {hudCollapsed ? (
            <TouchableOpacity
              style={styles.hudCollapsedPill}
              onPress={() => setHudCollapsed(false)}
              activeOpacity={0.8}
            >
              <View style={styles.hudGlowDot} />
              <Text style={styles.hudCollapsedText}>
                {triggerSource === 'action_button' ? '⚡ Action Button' : '⚡ Woray'} • 48kHz Active
                {handoffLatency !== null ? ` • ${handoffLatency}ms` : ''}
              </Text>
              <Text style={styles.hudChevron}>▾</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.hudExpandedCard}
              onPress={() => setHudCollapsed(true)}
              activeOpacity={0.95}
            >
              <View style={styles.hudHeaderRow}>
                <View style={styles.hudBadgeContainer}>
                  <Text style={styles.hudBadgeText}>
                    {triggerSource === 'action_button'
                      ? '⚡ ACTION BUTTON INVOKED'
                      : triggerSource === 'deep_link'
                      ? '🔗 DEEP LINK INVOKED'
                      : '👆 MANUAL INVOCATION'}
                  </Text>
                </View>

                {handoffLatency !== null && (
                  <View style={styles.hudLatencyBadge}>
                    <Text style={styles.hudLatencyText}>Handoff: {handoffLatency}ms</Text>
                  </View>
                )}
              </View>

              <View style={styles.hudTelemetryList}>
                {/* Step 1 */}
                <View style={styles.telemetryItem}>
                  <Text style={styles.telemetryIconDone}>✓</Text>
                  <Text style={styles.telemetryTextDone}>Hardware Intent Captured</Text>
                </View>

                {/* Step 2 */}
                <View style={styles.telemetryItem}>
                  {pipelineStep >= 2 ? (
                    <Text style={styles.telemetryIconDone}>✓</Text>
                  ) : (
                    <ActivityIndicator size="small" color="#f59e0b" style={styles.telemetrySpinner} />
                  )}
                  <Text
                    style={
                      pipelineStep >= 2 ? styles.telemetryTextDone : styles.telemetryTextPending
                    }
                  >
                    AudioSession & AEC Armed
                  </Text>
                </View>

                {/* Step 3 & 4 */}
                <View style={styles.telemetryItem}>
                  {pipelineStep >= 4 ? (
                    <Text style={styles.telemetryIconDone}>✓</Text>
                  ) : pipelineStep >= 3 ? (
                    <ActivityIndicator size="small" color="#06b6d4" style={styles.telemetrySpinner} />
                  ) : (
                    <Text style={styles.telemetryIconIdle}>○</Text>
                  )}
                  <Text
                    style={
                      pipelineStep >= 4 ? styles.telemetryTextDone : styles.telemetryTextPending
                    }
                  >
                    {pipelineStep >= 4
                      ? 'LiveKit 48kHz Stream Active'
                      : 'Joining WebRTC Room...'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* Top Navigation Bar */}
      <View style={styles.navBar}>
        <View style={styles.navTitleContainer}>
          <Text style={styles.brandTitle}>WO<Text style={styles.brandAccent}>RAY</Text></Text>
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
            onError={(err: any) => {
              console.error('[Woray] LiveKit room error:', err);
              setErrorMessage(err?.message || 'LiveKit room error');
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
                  const cleaned = hostInput.trim();
                  setBackendHost(cleaned);
                  if (Platform.OS === 'ios') {
                    Settings.set({ woray_backend_host: cleaned });
                  }
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
  /* Sleek Glassmorphic Live Caption Card */
  captionCard: {
    width: '100%',
    backgroundColor: 'rgba(24, 24, 27, 0.75)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    marginVertical: 12,
  },
  captionSpeakerSection: {
    marginVertical: 2,
  },
  captionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  speakerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  speakerUserDot: {
    backgroundColor: '#34d399',
  },
  speakerAgentDot: {
    backgroundColor: '#c084fc',
  },
  captionSpeakerTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  captionText: {
    fontSize: 13,
    color: '#f4f4f5',
    lineHeight: 18,
    fontWeight: '400',
  },
  captionPlaceholder: {
    color: '#52525b',
    fontStyle: 'italic',
  },
  captionDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 8,
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
  /* Action Button Invocation HUD Card */
  hudContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 16,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
  },
  hudCollapsedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 24, 0.94)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.45)',
    shadowColor: '#06b6d4',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  hudGlowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 8,
    shadowColor: '#10b981',
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  hudCollapsedText: {
    color: '#f4f4f5',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.2,
  },
  hudChevron: {
    color: '#71717a',
    fontSize: 12,
    marginLeft: 8,
  },
  hudExpandedCard: {
    width: '100%',
    backgroundColor: 'rgba(20, 20, 24, 0.96)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  hudHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  hudBadgeContainer: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.4)',
  },
  hudBadgeText: {
    color: '#22d3ee',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  hudLatencyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  hudLatencyText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hudTelemetryList: {
    gap: 8,
  },
  telemetryItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  telemetryIconDone: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '800',
    width: 22,
  },
  telemetryIconIdle: {
    color: '#52525b',
    fontSize: 14,
    width: 22,
  },
  telemetrySpinner: {
    width: 22,
    marginRight: 2,
  },
  telemetryTextDone: {
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '500',
  },
  telemetryTextPending: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '400',
  },
});
