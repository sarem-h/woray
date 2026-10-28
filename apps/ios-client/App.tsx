import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  StatusBar,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
  Settings,
  AppState,
  TouchableOpacity,
  type AppStateStatus,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  Easing,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
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
import { colors, radius, spacing, typography, springs, motion } from './theme';
import { AmbientBackground } from './components/AmbientBackground';
import { GlassSurface } from './components/GlassSurface';
import { GlassButton } from './components/GlassButton';
import { GlassRibbon } from './components/GlassRibbon';
import { Waveform } from './components/Waveform';

export type SessionState = 'Idle' | 'Connecting' | 'Listening' | 'AgentSpeaking';
export type TriggerSource = 'action_button' | 'deep_link' | 'manual';

export interface TranscriptItem {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

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
  onTranscriptUpdate,
}: {
  triggerSource: TriggerSource;
  onDisconnect: () => void;
  onStateChange: (state: SessionState) => void;
  onTranscriptUpdate: (item: TranscriptItem) => void;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();

  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [agentTranscript, setAgentTranscript] = useState<string>('');

  const shouldReduceMotion = useReducedMotion();
  const ringRotation = useSharedValue(0);

  // Real-time live speech & agent transcription listener
  useEffect(() => {
    if (!room) return;

    const handleTranscription = (
      segments: TranscriptionSegment[],
      participant?: Participant
    ) => {
      const text = segments.map((s) => s.text).join(' ').trim();
      if (!text) return;

      const isUser = participant?.isLocal;
      if (isUser) {
        setUserTranscript(text);
      } else {
        setAgentTranscript(text);
      }

      onTranscriptUpdate({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: isUser ? 'user' : 'agent',
        text,
      });
    };

    room.on(RoomEvent.TranscriptionReceived, handleTranscription);
    return () => {
      room.off(RoomEvent.TranscriptionReceived, handleTranscription);
    };
  }, [room, onTranscriptUpdate]);

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

  // Continuous rotation for connecting spinner
  useEffect(() => {
    if (currentVisualState === 'Connecting' && !shouldReduceMotion) {
      ringRotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      ringRotation.value = 0;
    }
  }, [currentVisualState, shouldReduceMotion, ringRotation]);

  const spinnerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringRotation.value}deg` }],
  }));

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
      {/* Session Top Badges */}
      <View style={styles.sessionHeaderRow}>
        <View style={styles.badgePill}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  currentVisualState === 'AgentSpeaking'
                    ? colors.accentSpeaking
                    : currentVisualState === 'Listening'
                    ? colors.accentListening
                    : colors.accentConnecting,
              },
            ]}
          />
          <Text style={styles.sessionStateText}>{currentVisualState}</Text>
        </View>

        <View style={styles.badgePill}>
          <Text style={styles.timerText}>{formatTimer(sessionSeconds)}</Text>
        </View>
      </View>

      {/* Trigger source label */}
      <View style={styles.triggerBadge}>
        <Text style={styles.triggerBadgeText}>
          {triggerSource === 'action_button'
            ? '⚡ Triggered by Action Button'
            : triggerSource === 'deep_link'
            ? '🔗 Triggered by Deep Link'
            : '👆 Manual Session'}
        </Text>
      </View>

      {/* Center Interactive Glass Card */}
      <View style={styles.centerCardContainer}>
        {currentVisualState === 'Connecting' && (
          <GlassSurface cornerRadius={radius.card} style={styles.activeCard}>
            <View style={styles.activeCardInner}>
              <Animated.View
                style={[
                  styles.connectingSpinner,
                  { borderTopColor: colors.accentConnecting },
                  spinnerAnimatedStyle,
                ]}
              />
              <Text style={styles.connectingTitle}>Connecting…</Text>
              <Text style={styles.connectingSubtitle}>
                Opening secure audio channel
              </Text>
            </View>
          </GlassSurface>
        )}

        {currentVisualState === 'Listening' && (
          <GlassSurface cornerRadius={radius.card} style={styles.activeCard}>
            <View style={styles.activeCardInner}>
              <View style={styles.stateHeadingRow}>
                <View
                  style={[
                    styles.stateAccentPill,
                    { backgroundColor: colors.accentListening },
                  ]}
                />
                <Text style={styles.stateTitle}>Listening</Text>
              </View>

              <Text style={styles.stateSubtitle}>
                {isLocalSpeaking
                  ? 'Transmitting speech…'
                  : 'Opus 48kHz Full-Duplex WebRTC stream active'}
              </Text>

              <View style={styles.waveformContainer}>
                <Waveform
                  amplitude={isLocalSpeaking ? 0.85 : 0.22}
                  colorPair={colors.gradientListening}
                />
              </View>

              {userTranscript ? (
                <Text style={styles.interimTranscript} numberOfLines={2}>
                  "{userTranscript}"
                </Text>
              ) : (
                <Text style={styles.interimPlaceholder}>
                  {isLocalSpeaking ? 'Transcribing…' : 'Speak naturally'}
                </Text>
              )}
            </View>
          </GlassSurface>
        )}

        {currentVisualState === 'AgentSpeaking' && (
          <GlassSurface cornerRadius={radius.card} style={styles.activeCard}>
            <View style={styles.activeCardInner}>
              <View style={styles.stateHeadingRow}>
                <View
                  style={[
                    styles.stateAccentPill,
                    { backgroundColor: colors.accentSpeaking },
                  ]}
                />
                <Text style={styles.stateTitle}>Woray</Text>
              </View>

              <Text style={styles.stateSubtitle}>
                Silero VAD active • Barge in anytime to interrupt
              </Text>

              <View style={styles.waveformContainer}>
                <Waveform
                  amplitude={0.65}
                  colorPair={colors.gradientSpeaking}
                />
              </View>

              {agentTranscript ? (
                <Text style={styles.interimTranscript} numberOfLines={2}>
                  "{agentTranscript}"
                </Text>
              ) : (
                <Text style={styles.interimPlaceholder}>Responding…</Text>
              )}
            </View>
          </GlassSurface>
        )}
      </View>

      {/* In-Session Action Bar */}
      <View style={styles.sessionControls}>
        <GlassButton
          onPress={toggleMicrophone}
          accessibilityLabel="Toggle microphone"
          style={styles.micButton}
        >
          <Text style={styles.micButtonIcon}>
            {isMicrophoneEnabled ? '🎙️' : '🔇'}
          </Text>
          <Text style={styles.micButtonLabel}>
            {isMicrophoneEnabled ? 'Mute' : 'Unmuted'}
          </Text>
        </GlassButton>

        <GlassButton
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            onDisconnect();
          }}
          accessibilityLabel="End voice session"
          style={styles.endButton}
          textStyle={styles.endButtonText}
          label="End"
        />
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

  // Transcript stack (up to 3 items)
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);

  // Action Button Invocation HUD Telemetry & State
  const [handoffLatency, setHandoffLatency] = useState<number | null>(null);
  const [hudVisible, setHudVisible] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(1);
  const lastConsumedTsRef = useRef<number>(0);

  const shouldReduceMotion = useReducedMotion();
  const hudTranslateY = useSharedValue(-140);
  const breatheAnim = useSharedValue(0);

  const initialUrl = Linking.useURL();
  const isStartingRef = useRef(false);
  const controlWsRef = useRef<WebSocket | null>(null);

  // Idle card breathing animation
  useEffect(() => {
    if (sessionState === 'Idle' && !shouldReduceMotion) {
      breatheAnim.value = withRepeat(
        withTiming(1, {
          duration: motion.breatheDuration / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else {
      breatheAnim.value = 0;
    }
  }, [sessionState, shouldReduceMotion, breatheAnim]);

  const idleCardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.02 * breatheAnim.value }],
  }));

  const breathingDotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + 0.4 * breatheAnim.value,
  }));

  const hudAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hudTranslateY.value }],
  }));

  // Append new transcript to stack
  const handleTranscriptUpdate = useCallback((item: TranscriptItem) => {
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === item.role) {
        const copy = [...prev];
        copy[copy.length - 1] = item;
        return copy.slice(-3);
      }
      return [...prev, item].slice(-3);
    });
  }, []);

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

      hudTranslateY.value = shouldReduceMotion ? 0 : withSpring(0, springs.state);

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
    [backendHost, startNativeAudio, stopNativeAudio, hudTranslateY, shouldReduceMotion]
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
      if (shouldReduceMotion) {
        hudTranslateY.value = -140;
        setHudVisible(false);
      } else {
        hudTranslateY.value = withTiming(-140, { duration: 250 }, (finished) => {
          if (finished) {
            runOnJS(setHudVisible)(false);
          }
        });
      }
    }
  }, [sessionState, hudTranslateY, shouldReduceMotion]);

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
    checkNativeActionButtonTrigger();

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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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

  const activeVisualState = errorMessage ? 'Error' : sessionState;

  return (
    <AmbientBackground state={activeVisualState}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <SafeAreaView style={styles.safeArea}>
        {/* Action Button Invocation HUD Telemetry Card */}
        {hudVisible && (
          <Animated.View style={[styles.hudContainer, hudAnimatedStyle]}>
            {hudCollapsed ? (
              <TouchableOpacity
                onPress={() => setHudCollapsed(false)}
                activeOpacity={0.8}
              >
                <GlassSurface cornerRadius={radius.pill} style={styles.hudCollapsedSurface}>
                  <View style={styles.hudCollapsedContent}>
                    <View style={styles.hudGlowDot} />
                    <Text style={styles.hudCollapsedText}>
                      {triggerSource === 'action_button' ? '⚡ Action Button' : '⚡ Woray'} • 48kHz Active
                      {handoffLatency !== null ? ` • ${handoffLatency}ms` : ''}
                    </Text>
                    <Text style={styles.hudChevron}>▾</Text>
                  </View>
                </GlassSurface>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setHudCollapsed(true)}
                activeOpacity={0.95}
                style={styles.hudExpandedWrapper}
              >
                <GlassSurface cornerRadius={radius.card} style={styles.hudExpandedSurface}>
                  <View style={styles.hudExpandedContent}>
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
                      <View style={styles.telemetryItem}>
                        <Text style={styles.telemetryIconDone}>✓</Text>
                        <Text style={styles.telemetryTextDone}>Hardware Intent Captured</Text>
                      </View>

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
                  </View>
                </GlassSurface>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* Header: App Name small, top center + Settings button */}
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.appName}>WORAY</Text>
          <TouchableOpacity
            style={styles.settingsButton}
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
            <GlassSurface cornerRadius={radius.card} style={styles.errorCard}>
              <View style={styles.errorInner}>
                <View style={styles.errorDot} />
                <Text style={styles.errorTitle}>Connection Notice</Text>
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
                <GlassButton
                  label="Retry"
                  onPress={() => {
                    setErrorMessage(null);
                    initiateSession('manual');
                  }}
                  style={styles.retryButton}
                />
              </View>
            </GlassSurface>
          )}

          {!errorMessage && sessionInfo && (
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
                onTranscriptUpdate={handleTranscriptUpdate}
              />
            </LiveKitRoom>
          )}

          {!errorMessage && !sessionInfo && (
            <View style={styles.idleWrapper}>
              <Animated.View style={idleCardAnimatedStyle}>
                <GlassSurface cornerRadius={radius.card} style={styles.idleCard}>
                  <View style={styles.idleCardInner}>
                    <View style={styles.breathingRow}>
                      <Animated.View
                        style={[
                          styles.breathingDot,
                          { backgroundColor: colors.accentReady },
                          breathingDotAnimatedStyle,
                        ]}
                      />
                      <Text style={styles.idleDisplayTitle}>Standby</Text>
                    </View>

                    <Text style={styles.idleSubtext}>
                      Hold Action Button to talk
                    </Text>

                    <GlassButton
                      label={sessionState === 'Connecting' ? 'Connecting…' : 'Start Voice Session'}
                      onPress={() => initiateSession('manual')}
                      disabled={sessionState === 'Connecting'}
                      style={styles.idleStartButton}
                    />
                  </View>
                </GlassSurface>
              </Animated.View>

              <View style={styles.backendStatusPill}>
                <View style={styles.backendDot} />
                <Text style={styles.backendStatusText} numberOfLines={1}>
                  Target: {backendHost}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Footer info (Idle / Standby) */}
        {!sessionInfo && (
          <View style={styles.footer}>
            <Text style={styles.footerHint}>
              Press Action Button on iPhone 17 or tap above to speak
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* Floating Transcript Ribbon Stack at Bottom */}
      {transcripts.length > 0 && (
        <View style={styles.ribbonStack} pointerEvents="none">
          {transcripts.map((entry) => (
            <GlassRibbon
              key={entry.id}
              role={entry.role}
              text={entry.text}
              persistent={false}
            />
          ))}
        </View>
      )}

      {/* Backend Host Config Modal */}
      <Modal
        visible={settingsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface cornerRadius={radius.card} style={styles.modalGlassCard}>
            <View style={styles.modalInner}>
              <Text style={styles.modalTitle}>Backend Settings</Text>
              <Text style={styles.modalDescription}>
                Set the IP address or host of your voice-backend server (e.g. Cloudflare tunnel or LAN IP).
              </Text>

              <TextInput
                style={styles.hostTextInput}
                value={hostInput}
                onChangeText={setHostInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="http://192.168.1.100:3001"
                placeholderTextColor={colors.textTertiary}
              />

              <View style={styles.modalButtonGroup}>
                <GlassButton
                  label="Cancel"
                  onPress={() => setSettingsModalVisible(false)}
                  style={styles.modalCancelButton}
                  textStyle={{ color: colors.textSecondary }}
                />

                <GlassButton
                  label="Save Host"
                  onPress={() => {
                    const cleaned = hostInput.trim();
                    setBackendHost(cleaned);
                    if (Platform.OS === 'ios') {
                      Settings.set({ woray_backend_host: cleaned });
                    }
                    setSettingsModalVisible(false);
                  }}
                  style={styles.modalSaveButton}
                />
              </View>
            </View>
          </GlassSurface>
        </View>
      </Modal>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerSpacer: {
    width: 36,
  },
  appName: {
    ...typography.caption,
    color: colors.textSecondary,
    letterSpacing: 2.5,
    fontWeight: '700',
  },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassSurface,
  },
  settingsIcon: {
    fontSize: 16,
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  /* HUD Container & Components */
  hudContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 20,
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    alignItems: 'center',
  },
  hudCollapsedSurface: {
    borderRadius: radius.pill,
  },
  hudCollapsedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  hudGlowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentReady,
    marginRight: 8,
  },
  hudCollapsedText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
  },
  hudChevron: {
    color: colors.textSecondary,
    fontSize: 12,
    marginLeft: 8,
  },
  hudExpandedWrapper: {
    width: '100%',
  },
  hudExpandedSurface: {
    borderRadius: radius.card,
    width: '100%',
  },
  hudExpandedContent: {
    padding: spacing.md,
  },
  hudHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  hudBadgeContainer: {
    backgroundColor: 'rgba(91, 143, 255, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.small,
  },
  hudBadgeText: {
    ...typography.caption,
    color: colors.accentConnecting,
    fontWeight: '800',
    fontSize: 11,
  },
  hudLatencyBadge: {
    backgroundColor: 'rgba(91, 229, 155, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.small,
  },
  hudLatencyText: {
    ...typography.caption,
    color: colors.accentReady,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
    fontSize: 11,
  },
  hudTelemetryList: {
    gap: 6,
  },
  telemetryItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  telemetryIconDone: {
    color: colors.accentReady,
    fontSize: 13,
    fontWeight: '800',
    width: 20,
  },
  telemetryIconIdle: {
    color: colors.textTertiary,
    fontSize: 13,
    width: 20,
  },
  telemetrySpinner: {
    width: 20,
    marginRight: 2,
  },
  telemetryTextDone: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  telemetryTextPending: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  /* Idle State */
  idleWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleCard: {
    width: 320,
    borderRadius: radius.card,
  },
  idleCardInner: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  breathingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  breathingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  idleDisplayTitle: {
    ...typography.display,
    color: colors.textPrimary,
  },
  idleSubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  idleStartButton: {
    marginTop: spacing.xs,
  },
  backendStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassSurface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginTop: spacing.lg,
    maxWidth: '85%',
  },
  backendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentReady,
    marginRight: 8,
  },
  backendStatusText: {
    fontSize: 11,
    color: colors.textTertiary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  /* Session Inner Container */
  sessionContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassSurface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sessionStateText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  timerText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  triggerBadge: {
    marginTop: 6,
    backgroundColor: 'rgba(91, 143, 255, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.small,
  },
  triggerBadgeText: {
    ...typography.caption,
    color: colors.accentConnecting,
    fontSize: 11,
  },
  centerCardContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  activeCard: {
    width: '90%',
    maxWidth: 340,
    borderRadius: radius.card,
  },
  activeCardInner: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  connectingSpinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: 'transparent',
    marginBottom: spacing.md,
  },
  connectingTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  connectingSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stateHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  stateAccentPill: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  stateTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  stateSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  waveformContainer: {
    width: '100%',
    marginVertical: spacing.sm,
  },
  interimTranscript: {
    ...typography.transcript,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  interimPlaceholder: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  sessionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  micButton: {
    minWidth: 100,
  },
  micButtonIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  micButtonLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  endButton: {
    minWidth: 90,
  },
  endButtonText: {
    color: colors.accentError,
    fontWeight: '700',
  },
  /* Error Card */
  errorCard: {
    width: 320,
    borderRadius: radius.card,
  },
  errorInner: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  errorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accentError,
    marginBottom: spacing.sm,
  },
  errorTitle: {
    ...typography.title,
    color: colors.accentError,
    marginBottom: 6,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    marginTop: spacing.xs,
  },
  /* Footer */
  footer: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  footerHint: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  /* Ribbon Stack */
  ribbonStack: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalGlassCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.card,
  },
  modalInner: {
    padding: spacing.lg,
  },
  modalTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  modalDescription: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  hostTextInput: {
    backgroundColor: colors.glassSurface,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.small,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: spacing.lg,
  },
  modalButtonGroup: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalCancelButton: {
    minWidth: 80,
  },
  modalSaveButton: {
    minWidth: 100,
  },
});
