import { initializeLogger, stt, llm, tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as google from '@livekit/agents-plugin-google';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';

import { pipelineConfig } from '../config/pipeline.config.js';
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
  switch (pipelineConfig.stt.provider) {
    case 'deepgram': {
      const cfg = pipelineConfig.stt.deepgram;
      return new deepgram.STT({
        model: cfg.model,
        interimResults: cfg.interimResults,
        smartFormat: cfg.smartFormat,
        endpointing: cfg.endpointingMs,
        apiKey: cfg.apiKey,
      });
    }

    case 'openai': {
      const cfg = pipelineConfig.stt.openai;
      return new openai.STT({
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported STT provider: "${pipelineConfig.stt.provider}"`);
  }
}

/**
 * Creates the active Large Language Model provider
 */
export function createLLM(): llm.LLM {
  switch (pipelineConfig.llm.provider) {
    case 'bedrock': {
      const cfg = pipelineConfig.llm.bedrock;
      return new BedrockLLM({
        modelId: cfg.primaryModelId,
        region: cfg.region,
        bearerToken: cfg.bearerToken,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
      });
    }

    case 'openai': {
      const cfg = pipelineConfig.llm.openai;
      return new openai.LLM({
        model: cfg.model,
        temperature: cfg.temperature,
        apiKey: cfg.apiKey,
      });
    }

    case 'google': {
      const cfg = pipelineConfig.llm.google;
      return new google.LLM({
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported LLM provider: "${pipelineConfig.llm.provider}"`);
  }
}

/**
 * Creates the active Text-to-Speech provider
 */
export function createTTS(): tts.TTS {
  switch (pipelineConfig.tts.provider) {
    case 'deepgram': {
      const cfg = pipelineConfig.tts.deepgram;
      return createDeepgramTTS(cfg.apiKey, cfg.voice);
    }

    case 'cartesia': {
      const cfg = pipelineConfig.tts.cartesia;
      return new cartesia.TTS({
        model: cfg.model,
        voice: cfg.voiceId,
        apiKey: cfg.apiKey,
      });
    }

    case 'elevenlabs': {
      const cfg = pipelineConfig.tts.elevenlabs;
      return new elevenlabs.TTS({
        model: cfg.model,
        voiceId: cfg.voiceId,
        apiKey: cfg.apiKey,
      });
    }

    case 'openai': {
      const cfg = pipelineConfig.tts.openai;
      return new openai.TTS({
        model: cfg.model,
        voice: cfg.voice as any,
        apiKey: cfg.apiKey,
      });
    }

    default:
      throw new Error(`Unsupported TTS provider: "${pipelineConfig.tts.provider}"`);
  }
}

/**
 * Prints a clean ASCII overview of the active pipeline configuration
 */
export function logActivePipelineSummary(): void {
  const pad = (str: string, len: number) => (str.length > len ? str.slice(0, len - 3) + '...' : str.padEnd(len));

  const sttDetail = `${pipelineConfig.stt.provider} (${pipelineConfig.stt.provider === 'deepgram' ? pipelineConfig.stt.deepgram.model : pipelineConfig.stt.openai.model})`;
  const llmDetail = `${pipelineConfig.llm.provider} (${pipelineConfig.llm.provider === 'bedrock' ? pipelineConfig.llm.bedrock.primaryModelId : pipelineConfig.llm.provider === 'openai' ? pipelineConfig.llm.openai.model : pipelineConfig.llm.google.model})`;
  const ttsDetail = `${pipelineConfig.tts.provider} (${pipelineConfig.tts.provider === 'deepgram' ? pipelineConfig.tts.deepgram.voice : pipelineConfig.tts.provider === 'cartesia' ? pipelineConfig.tts.cartesia.model : pipelineConfig.tts.provider === 'elevenlabs' ? pipelineConfig.tts.elevenlabs.model : pipelineConfig.tts.openai.model})`;

  console.log('┌────────────────────────────────────────────────────────┐');
  console.log('│          🎙️  WORAY VOICE PIPELINE REGISTRY             │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log(`│ STT Provider : ${pad(sttDetail, 39)} │`);
  console.log(`│ LLM Provider : ${pad(llmDetail, 39)} │`);
  console.log(`│ TTS Provider : ${pad(ttsDetail, 39)} │`);
  console.log('└────────────────────────────────────────────────────────┘');
}
