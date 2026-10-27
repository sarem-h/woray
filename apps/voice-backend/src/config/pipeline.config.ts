import { secrets } from './secrets.js';

export const pipelineConfig = Object.freeze({
  server: {
    port: 3001,
  },

  livekit: {
    url: secrets.livekit.url,
    apiKey: secrets.livekit.apiKey,
    apiSecret: secrets.livekit.apiSecret,
    agentName: 'woray-agent',
  },

  stt: {
    provider: 'deepgram' as 'deepgram' | 'openai',
    deepgram: {
      model: 'nova-2-conversationalai',
      apiKey: secrets.deepgram.apiKey,
      language: 'en-US',
      interimResults: true,
      smartFormat: true,
      endpointingMs: 300,
    },
    openai: {
      model: 'whisper-1',
      apiKey: secrets.openai.apiKey,
    },
  },

  llm: {
    provider: 'bedrock' as 'bedrock' | 'openai' | 'google',
    bedrock: {
      region: 'us-east-1',
      bearerToken: secrets.bedrock.bearerToken,
      primaryModelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      fallbackModelId: 'amazon.nova-lite-v1:0',
      // true = fall back silently but log loudly; false = crash on primary error
      allowFallback: true,
      temperature: 0.6,
      maxTokens: 512,
    },
    openai: {
      model: 'gpt-4o-mini',
      apiKey: secrets.openai.apiKey,
      temperature: 0.6,
      maxTokens: 512,
    },
    google: {
      model: 'gemini-2.0-flash',
      apiKey: secrets.google.apiKey,
      temperature: 0.6,
      maxTokens: 512,
    },
  },

  tts: {
    provider: 'deepgram' as 'deepgram' | 'cartesia' | 'elevenlabs' | 'openai',
    deepgram: {
      voice: 'aura-asteria-en',
      apiKey: secrets.deepgram.apiKey,
      sampleRate: 24000,
    },
    cartesia: {
      voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
      model: 'sonic-english',
      apiKey: secrets.cartesia.apiKey,
    },
    elevenlabs: {
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      model: 'eleven_turbo_v2_5',
      apiKey: secrets.elevenlabs.apiKey,
    },
    openai: {
      voice: 'alloy',
      model: 'tts-1',
      apiKey: secrets.openai.apiKey,
    },
  },
});

export type PipelineConfig = typeof pipelineConfig;
