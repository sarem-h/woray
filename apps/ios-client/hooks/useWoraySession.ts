import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Platform, Settings, AppState, type AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
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
import runtimeConfig from '../runtime-config.json';

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

export interface WoraySession {
  sessionState: SessionState;
  errorMessage: string | null;
  transcripts: TranscriptItem[];
  liveUserText: string;
  liveAgentText: string;
  isMicMuted: boolean;
  sessionDurationMs: number;
  actionButtonLatencyMs: number | null;
  triggerSource: TriggerSource;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  toggleMic: () => Promise<void>;
  roomToken: string | null;
  roomServerUrl: string | null;
  roomName: string | null;
  liveKitRoomProps: {
    connect: boolean;
    audio: boolean;
    video: boolean;
    onDisconnected: () => void;
    onError: (err: any) => void;
    options: {
      audioCaptureDefaults: {
        echoCancellation: boolean;
        noiseSuppression: boolean;
        autoGainControl: boolean;
      };
    };
  };
  RoomSessionView: React.ComponentType;
  __setPreviewState?: (s: SessionState) => void;
}

export interface UseWoraySessionOptions {
  previewState?: SessionState;
  previewTranscripts?: TranscriptItem[];
  previewError?: string;
}

/**
 * VoiceAssistantSessionView: Active LiveKit Room inner component.
 * Tracks local participant mic activity, agent voice assistant state, and
 * reports reactive state back to the parent hook. Renders no JSX.
 * Must be rendered INSIDE a <LiveKitRoom> so its room-context hooks resolve.
 */
function VoiceAssistantSessionView(props: {
  onStateChange: (state: SessionState) => void;
  onTranscriptUpdate: (item: TranscriptItem) => void;
  onLiveUserChange: (text: string) => void;
  onLiveAgentChange: (text: string) => void;
  onMicStateChange: (isMuted: boolean, isSpeaking: boolean) => void;
  onDurationChange: (seconds: number) => void;
  registerToggleMic: (fn: () => Promise<void>) => void;
}) {
  const {
    onStateChange,
    onTranscriptUpdate,
    onLiveUserChange,
    onLiveAgentChange,
    onMicStateChange,
    onDurationChange,
    registerToggleMic,
  } = props;
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();

  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [agentTranscript, setAgentTranscript] = useState<string>('');

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

  // Mirror live transcripts / mic / duration up to the hook
  useEffect(() => {
    onLiveUserChange(userTranscript);
  }, [userTranscript, onLiveUserChange]);

  useEffect(() => {
    onLiveAgentChange(agentTranscript);
  }, [agentTranscript, onLiveAgentChange]);

  useEffect(() => {
    onDurationChange(sessionSeconds);
  }, [sessionSeconds, onDurationChange]);

  useEffect(() => {
    onMicStateChange(!isMicrophoneEnabled, isLocalSpeaking);
  }, [isMicrophoneEnabled, isLocalSpeaking, onMicStateChange]);

  // Toggle microphone (registered with the hook so the UI can invoke it)
  const toggleMicrophone = useCallback(async () => {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (room && localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    }
  }, [room, localParticipant, isMicrophoneEnabled]);

  useEffect(() => {
    registerToggleMic(toggleMicrophone);
  }, [toggleMicrophone, registerToggleMic]);

  // No visual JSX — presentation is handled entirely by the outer UI layer.
  return null;
}

/**
 * useWoraySession: owns ALL session/business logic for Woray (LiveKit room
 * lifecycle, control WebSocket, Action Button polling, state machine,
 * transcripts, haptics, session timer, mic toggle). The UI layer only reads
 * the returned state and calls the returned actions.
 */
export function useWoraySession(
  options: UseWoraySessionOptions = {}
): WoraySession {
  const [sessionState, setSessionState] = useState<SessionState>('Idle');
  const [sessionInfo, setSessionInfo] = useState<SessionTokenResponse | null>(null);
  const [triggerSource, setTriggerSource] = useState<TriggerSource>('manual');
  const [backendHost] = useState<string>(DEFAULT_BACKEND_HOST);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [handoffLatency, setHandoffLatency] = useState<number | null>(null);

  const [liveUserText, setLiveUserText] = useState('');
  const [liveAgentText, setLiveAgentText] = useState('');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // Dev-only preview override (settable via __setPreviewState)
  const [previewOverride, setPreviewOverride] = useState<SessionState | undefined>(
    options.previewState
  );

  const lastConsumedTsRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const controlWsRef = useRef<WebSocket | null>(null);
  const toggleMicRef = useRef<() => Promise<void>>(async () => {});

  const initialUrl = Linking.useURL();

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
    if (Platform.OS === 'web') return;
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

  // Fetch token and initiate LiveKit WebRTC connection with dynamic room isolation & latency telemetry
  const initiateSession = useCallback(
    async (source: TriggerSource, handoffLatencyMs?: number) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      setErrorMessage(null);
      setTriggerSource(source);
      setSessionState('Connecting');
      setHandoffLatency(handoffLatencyMs ?? null);

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
        if (Platform.OS !== 'web') {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await startNativeAudio();
        }

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
        if (Platform.OS !== 'web') {
          await stopNativeAudio();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } finally {
        isStartingRef.current = false;
      }
    },
    [backendHost, startNativeAudio, stopNativeAudio]
  );

  // Detect hardware Action Button trigger via native-shared timestamp in Settings
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
    if (Platform.OS === 'web') return;
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
    if (Platform.OS !== 'web') {
      await stopNativeAudio();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
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
    if (Platform.OS === 'web') return;
    handleUrl(initialUrl);

    const sub = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => sub.remove();
  }, [initialUrl, handleUrl]);

  /* ---- Public actions ---- */
  const startSession = useCallback(async () => {
    await initiateSession('manual');
  }, [initiateSession]);

  const endSession = useCallback(async () => {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    await handleDisconnect();
  }, [handleDisconnect]);

  const toggleMic = useCallback(async () => {
    await toggleMicRef.current();
  }, []);

  const registerToggleMic = useCallback((fn: () => Promise<void>) => {
    toggleMicRef.current = fn;
  }, []);

  /* ---- Room bridge: mounts the inner room-context view inside <LiveKitRoom> ---- */
  const RoomSessionView = useCallback(
    () =>
      React.createElement(VoiceAssistantSessionView, {
        onStateChange: setSessionState,
        onTranscriptUpdate: handleTranscriptUpdate,
        onLiveUserChange: setLiveUserText,
        onLiveAgentChange: setLiveAgentText,
        onMicStateChange: (isMuted: boolean) => setIsMicMuted(isMuted),
        onDurationChange: setSessionSeconds,
        registerToggleMic,
      }),
    [handleTranscriptUpdate, registerToggleMic]
  );

  /* ---- Dev-only preview escape hatch ---- */
  const __setPreviewState = useCallback((s: SessionState) => {
    setPreviewOverride(s);
  }, []);

  const effectiveSessionState = previewOverride ?? sessionState;
  const effectiveError = options.previewError ?? errorMessage;
  const effectiveTranscripts = options.previewTranscripts ?? transcripts;

  return {
    sessionState: effectiveSessionState,
    errorMessage: effectiveError,
    transcripts: effectiveTranscripts,
    liveUserText,
    liveAgentText,
    isMicMuted,
    sessionDurationMs: sessionSeconds * 1000,
    actionButtonLatencyMs: handoffLatency,
    triggerSource,
    startSession,
    endSession,
    toggleMic,
    roomToken: sessionInfo?.token ?? null,
    roomServerUrl: sessionInfo?.wsUrl ?? null,
    roomName: sessionInfo?.room ?? null,
    liveKitRoomProps: {
      connect: true,
      audio: true,
      video: false,
      onDisconnected: handleDisconnect,
      onError: (err: any) => {
        console.error('[Woray] LiveKit room error:', err);
        setErrorMessage(err?.message || 'LiveKit room error');
        handleDisconnect();
      },
      options: {
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
    },
    RoomSessionView,
    __setPreviewState,
  };
}

