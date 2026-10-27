export type STTConfig =
  | {
      provider: 'deepgram';
      model: string;
      language: string;
      interimResults: boolean;
      smartFormat: boolean;
      endpointingMs: number;
      keywords?: readonly (readonly [string, number])[];
    }
  | {
      provider: 'openai';
      model: string;
    };

export type LLMConfig =
  | {
      provider: 'bedrock';
      region: string;
      modelId: string;
      temperature: number;
      maxTokens: number;
    }
  | {
      provider: 'openai';
      model: string;
      temperature: number;
      maxTokens: number;
    }
  | {
      provider: 'google';
      model: string;
      temperature: number;
      maxTokens: number;
    };

export type TTSConfig =
  | {
      provider: 'deepgram';
      voice: string;
      sampleRate: number;
      speed?: number;        // 0.5 to 1.5 (Flux /v2/speak parameter, default 1)
      expressivity?: number; // -2 to 2 (Flux /v2/speak parameter, default 0)
    }
  | {
      provider: 'cartesia';
      model: string;
      voiceId: string;
    }
  | {
      provider: 'elevenlabs';
      model: string;
      voiceId: string;
    }
  | {
      provider: 'openai';
      model: string;
      voice: string;
    };

export interface TurnDetectionConfig {
  readonly minEndpointingDelayMs: number;
  readonly maxEndpointingDelayMs: number;
  readonly preemptiveGeneration: boolean;
}

export interface WorayConfig {
  readonly server: {
    readonly port: number;
  };
  readonly livekit: {
    readonly agentName: string;
    readonly numIdleProcesses?: number;
  };
  readonly turnDetection: Readonly<TurnDetectionConfig>;
  readonly stt: Readonly<STTConfig>;
  readonly llm: Readonly<LLMConfig>;
  readonly tts: Readonly<TTSConfig>;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.getOwnPropertyNames(obj).forEach((key) => {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') {
      deepFreeze(val as object);
    }
  });
  return Object.freeze(obj);
}

export function defineWorayConfig(config: WorayConfig): Readonly<WorayConfig> {
  return deepFreeze(config);
}
