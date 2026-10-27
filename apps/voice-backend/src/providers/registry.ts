import { initializeLogger, stt, llm, tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as google from '@livekit/agents-plugin-google';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';

import { worayConfig } from '../../woray.config.js';
import { secrets } from '../config/secrets.js';
import { BedrockLLM } from './bedrock-llm.js';
import { createDeepgramTTS } from './deepgram-tts.js';

// Ensure LiveKit internal logger is ready even when used in scripts/tests outside cli.runApp
try {
  initializeLogger({ pretty: false });
} catch {
  // Ignored if already initialized
}

/**
 * Creates the active Speech-to-Text provider
 */
export function createSTT(): stt.STT {
  const cfg = worayConfig.stt;
  switch (cfg.provider) {
    case 'deepgram':
      return new deepgram.STT({
        model: cfg.model,
        interimResults: cfg.interimResults,
        smartFormat: cfg.smartFormat,
        endpointing: cfg.endpointingMs,
        apiKey: secrets.deepgram.apiKey,
      });

    case 'openai':
      return new openai.STT({
        model: cfg.model,
        apiKey: secrets.openai.apiKey,
      });

    default:
      throw new Error(`Unsupported STT provider: "${(cfg as { provider: string }).provider}"`);
  }
}

/**
 * Creates the active Large Language Model provider
 */
export function createLLM(): llm.LLM {
  const cfg = worayConfig.llm;
  switch (cfg.provider) {
    case 'bedrock':
      return new BedrockLLM({
        modelId: cfg.modelId,
        region: cfg.region,
        bearerToken: secrets.bedrock.bearerToken,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
      });

    case 'openai':
      return new openai.LLM({
        model: cfg.model,
        temperature: cfg.temperature,
        apiKey: secrets.openai.apiKey,
      });

    case 'google':
      return new google.LLM({
        model: cfg.model,
        apiKey: secrets.google.apiKey,
      });

    default:
      throw new Error(`Unsupported LLM provider: "${(cfg as { provider: string }).provider}"`);
  }
}

/**
 * Creates the active Text-to-Speech provider
 */
export function createTTS(): tts.TTS {
  const cfg = worayConfig.tts;
  switch (cfg.provider) {
    case 'deepgram':
      return createDeepgramTTS(secrets.deepgram.apiKey, cfg.voice);

    case 'cartesia':
      return new cartesia.TTS({
        model: cfg.model,
        voice: cfg.voiceId,
        apiKey: secrets.cartesia.apiKey,
      });

    case 'elevenlabs':
      return new elevenlabs.TTS({
        model: cfg.model,
        voiceId: cfg.voiceId,
        apiKey: secrets.elevenlabs.apiKey,
      });

    case 'openai':
      return new openai.TTS({
        model: cfg.model,
        voice: cfg.voice as any,
        apiKey: secrets.openai.apiKey,
      });

    default:
      throw new Error(`Unsupported TTS provider: "${(cfg as { provider: string }).provider}"`);
  }
}

/**
 * Prints a clean ASCII overview of the active pipeline configuration
 */
export function logActivePipelineSummary(): void {
  const pad = (str: string, len: number) => (str.length > len ? str.slice(0, len - 3) + '...' : str.padEnd(len));

  const stt = worayConfig.stt;
  const llm = worayConfig.llm;
  const tts = worayConfig.tts;

  const sttModel = stt.provider === 'deepgram' ? stt.model : stt.model;
  const llmModel = llm.provider === 'bedrock' ? llm.modelId : llm.model;
  const ttsDetail = tts.provider === 'deepgram' ? tts.voice : tts.provider === 'openai' ? tts.model : tts.model;

  const sttDetailStr = `${stt.provider} (${sttModel})`;
  const llmDetailStr = `${llm.provider} (${llmModel})`;
  const ttsDetailStr = `${tts.provider} (${ttsDetail})`;

  console.log('┌────────────────────────────────────────────────────────┐');
  console.log('│          🎙️  WORAY VOICE PIPELINE REGISTRY             │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log(`│ STT Provider : ${pad(sttDetailStr, 39)} │`);
  console.log(`│ LLM Provider : ${pad(llmDetailStr, 39)} │`);
  console.log(`│ TTS Provider : ${pad(ttsDetailStr, 39)} │`);
  console.log('└────────────────────────────────────────────────────────┘');
}
