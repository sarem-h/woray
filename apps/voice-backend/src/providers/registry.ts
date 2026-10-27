import { initializeLogger, stt, llm, tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as google from '@livekit/agents-plugin-google';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';

import { worayConfig } from '../../woray.config.js';
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
  switch (worayConfig.stt.provider) {
    case 'deepgram': {
      const cfg = worayConfig.stt.deepgram;
      return new deepgram.STT({
        model: cfg.model,
        interimResults: cfg.interimResults,
        smartFormat: cfg.smartFormat,
        endpointing: cfg.endpointingMs,
        apiKey: cfg.apiKey,
      });
    }

    case 'openai': {
      const cfg = worayConfig.stt.openai;
      return new openai.STT({
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported STT provider: "${worayConfig.stt.provider}"`);
  }
}

/**
 * Creates the active Large Language Model provider
 */
export function createLLM(): llm.LLM {
  switch (worayConfig.llm.provider) {
    case 'bedrock': {
      const cfg = worayConfig.llm.bedrock;
      return new BedrockLLM({
        modelId: cfg.modelId,
        region: cfg.region,
        bearerToken: cfg.bearerToken,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
      });
    }

    case 'openai': {
      const cfg = worayConfig.llm.openai;
      return new openai.LLM({
        model: cfg.model,
        temperature: cfg.temperature,
        apiKey: cfg.apiKey,
      });
    }

    case 'google': {
      const cfg = worayConfig.llm.google;
      return new google.LLM({
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported LLM provider: "${worayConfig.llm.provider}"`);
  }
}

/**
 * Creates the active Text-to-Speech provider
 */
export function createTTS(): tts.TTS {
  switch (worayConfig.tts.provider) {
    case 'deepgram': {
      const cfg = worayConfig.tts.deepgram;
      return createDeepgramTTS(cfg.apiKey, cfg.voice);
    }

    case 'cartesia': {
      const cfg = worayConfig.tts.cartesia;
      return new cartesia.TTS({
        model: cfg.model,
        voice: cfg.voiceId,
        apiKey: cfg.apiKey,
      });
    }

    case 'elevenlabs': {
      const cfg = worayConfig.tts.elevenlabs;
      return new elevenlabs.TTS({
        model: cfg.model,
        voiceId: cfg.voiceId,
        apiKey: cfg.apiKey,
      });
    }

    case 'openai': {
      const cfg = worayConfig.tts.openai;
      return new openai.TTS({
        model: cfg.model,
        voice: cfg.voice as any,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported TTS provider: "${worayConfig.tts.provider}"`);
  }
}

/**
 * Prints a clean ASCII overview of the active pipeline configuration
 */
export function logActivePipelineSummary(): void {
  const pad = (str: string, len: number) => (str.length > len ? str.slice(0, len - 3) + '...' : str.padEnd(len));

  const sttDetail = `${worayConfig.stt.provider} (${worayConfig.stt.provider === 'deepgram' ? worayConfig.stt.deepgram.model : worayConfig.stt.openai.model})`;
  const llmDetail = `${worayConfig.llm.provider} (${worayConfig.llm.provider === 'bedrock' ? worayConfig.llm.bedrock.modelId : worayConfig.llm.provider === 'openai' ? worayConfig.llm.openai.model : worayConfig.llm.google.model})`;
  const ttsDetail = `${worayConfig.tts.provider} (${worayConfig.tts.provider === 'deepgram' ? worayConfig.tts.deepgram.voice : worayConfig.tts.provider === 'cartesia' ? worayConfig.tts.cartesia.model : worayConfig.tts.provider === 'elevenlabs' ? worayConfig.tts.elevenlabs.model : worayConfig.tts.openai.model})`;

  console.log('┌────────────────────────────────────────────────────────┐');
  console.log('│          🎙️  WORAY VOICE PIPELINE REGISTRY             │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log(`│ STT Provider : ${pad(sttDetail, 39)} │`);
  console.log(`│ LLM Provider : ${pad(llmDetail, 39)} │`);
  console.log(`│ TTS Provider : ${pad(ttsDetail, 39)} │`);
  console.log('└────────────────────────────────────────────────────────┘');
}
