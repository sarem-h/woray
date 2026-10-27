import { secrets } from './src/config/secrets.js';

export const worayConfig = Object.freeze({
  server: {
    port: 3001,
  },

  livekit: {
    agentName: 'woray-agent',
    url: secrets.livekit.url,
    apiKey: secrets.livekit.apiKey,
    apiSecret: secrets.livekit.apiSecret,
  },

  prompts: {
    greeting: 'Woray online. Go ahead.',
    agentInstructions:
      'You are Woray, a concise real-time voice assistant. Keep responses short — 2-3 sentences max. Do not use markdown, lists, or formatting. Speak naturally. When you do not know something, say so briefly.',
  },

  stt: {
    provider: 'deepgram' as 'deepgram' | 'openai',
    deepgram: {
      model: 'nova-2-conversationalai',
      language: 'en-US',
      interimResults: true,
      smartFormat: true,
      endpointingMs: 300,
      apiKey: secrets.deepgram.apiKey,
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
      modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      temperature: 0.6,
      maxTokens: 512,
      bearerToken: secrets.bedrock.bearerToken,
    },
    openai: {
      model: 'gpt-4o-mini',
      temperature: 0.6,
      maxTokens: 512,
      apiKey: secrets.openai.apiKey,
    },
    google: {
      model: 'gemini-2.0-flash',
      temperature: 0.6,
      maxTokens: 512,
      apiKey: secrets.google.apiKey,
    },
  },

  tts: {
    provider: 'deepgram' as 'deepgram' | 'cartesia' | 'elevenlabs' | 'openai',
    deepgram: {
      voice: 'aura-asteria-en',
      sampleRate: 24000,
      apiKey: secrets.deepgram.apiKey,
    },
    cartesia: {
      model: 'sonic-english',
      voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
      apiKey: secrets.cartesia.apiKey,
    },
    elevenlabs: {
      model: 'eleven_turbo_v2_5',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      apiKey: secrets.elevenlabs.apiKey,
    },
    openai: {
      model: 'tts-1',
      voice: 'alloy',
      apiKey: secrets.openai.apiKey,
    },
  },
});

export type WorayConfig = typeof worayConfig;
