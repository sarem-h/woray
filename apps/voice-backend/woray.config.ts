import { defineWorayConfig } from './src/config/schema.js';

export const worayConfig = defineWorayConfig({
  server: {
    port: 3001,
  },

  livekit: {
    agentName: '',
    numIdleProcesses: 1,
  },

  turnDetection: {
    minEndpointingDelayMs: 250,
    maxEndpointingDelayMs: 800,
    preemptiveGeneration: true,
  },

  stt: {
    provider: 'deepgram',
    model: 'nova-2-conversationalai',
    language: 'en-US',
    interimResults: true,
    smartFormat: true,
    endpointingMs: 250,
    keywords: [['Woray', 5]],
  },

  llm: {
    provider: 'bedrock',
    region: 'us-east-1',
    modelId: 'us.meta.llama4-scout-17b-instruct-v1:0',
    temperature: 0.6,
    maxTokens: 512,
  },

  tts: {
    provider: 'deepgram',
    voice: 'flux-hannah-en',
    sampleRate: 24000,
    speed: 1,
    expressivity: 0,
  },
});

export default worayConfig;
