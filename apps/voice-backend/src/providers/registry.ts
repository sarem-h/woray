import { initializeLogger, stt, llm, tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as google from '@livekit/agents-plugin-google';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';

import { getPipelineConfig, requireValidKey } from './config.js';
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
  const cfg = getPipelineConfig();

  switch (cfg.stt) {
    case 'deepgram': {
      const apiKey = requireValidKey('DEEPGRAM_API_KEY', 'Deepgram STT');
      return new deepgram.STT({
        model: cfg.deepgramSttModel,
        interimResults: true,
        smartFormat: true,
        endpointing: 300,
        apiKey,
      });
    }

    case 'openai': {
      const apiKey = requireValidKey('OPENAI_API_KEY', 'OpenAI STT');
      return new openai.STT({
        model: 'whisper-1',
        apiKey,
      });
    }

    default:
      throw new Error(`Unsupported STT provider: "${cfg.stt}"`);
  }
}

/**
 * Creates the active Large Language Model provider
 */
export function createLLM(): llm.LLM {
  const cfg = getPipelineConfig();

  switch (cfg.llm) {
    case 'bedrock': {
      const bearerToken = requireValidKey('AWS_BEARER_TOKEN_BEDROCK', 'AWS Bedrock LLM');
      return new BedrockLLM({
        modelId: cfg.bedrockModelId,
        region: cfg.awsRegion,
        bearerToken,
      });
    }

    case 'openai': {
      const apiKey = requireValidKey('OPENAI_API_KEY', 'OpenAI LLM');
      return new openai.LLM({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        apiKey,
      });
    }

    case 'google': {
      const apiKey = requireValidKey('GOOGLE_API_KEY', 'Google Gemini LLM');
      return new google.LLM({
        model: 'gemini-2.0-flash',
        apiKey,
      });
    }

    default:
      throw new Error(`Unsupported LLM provider: "${cfg.llm}"`);
  }
}

/**
 * Creates the active Text-to-Speech provider
 */
export function createTTS(): tts.TTS {
  const cfg = getPipelineConfig();

  switch (cfg.tts) {
    case 'deepgram': {
      const apiKey = requireValidKey('DEEPGRAM_API_KEY', 'Deepgram Aura TTS');
      return createDeepgramTTS(apiKey, cfg.deepgramTtsVoice);
    }

    case 'cartesia': {
      const apiKey = requireValidKey('CARTESIA_API_KEY', 'Cartesia Sonic TTS');
      return new cartesia.TTS({
        model: 'sonic-english',
        voice: cfg.cartesiaVoiceId,
        apiKey,
      });
    }

    case 'elevenlabs': {
      const apiKey = requireValidKey('ELEVENLABS_API_KEY', 'ElevenLabs Turbo TTS');
      return new elevenlabs.TTS({
        model: 'eleven_turbo_v2_5',
        apiKey,
      });
    }

    case 'openai': {
      const apiKey = requireValidKey('OPENAI_API_KEY', 'OpenAI TTS');
      return new openai.TTS({
        model: 'tts-1',
        voice: 'alloy',
        apiKey,
      });
    }

    default:
      throw new Error(`Unsupported TTS provider: "${cfg.tts}"`);
  }
}

/**
 * Prints a clean ASCII overview of the active pipeline configuration
 */
export function logActivePipelineSummary(): void {
  const cfg = getPipelineConfig();

  const pad = (str: string, len: number) => (str.length > len ? str.slice(0, len - 3) + '...' : str.padEnd(len));

  const sttDetail = `${cfg.stt} (${cfg.stt === 'deepgram' ? cfg.deepgramSttModel : 'whisper-1'})`;
  const llmDetail = `${cfg.llm} (${cfg.llm === 'bedrock' ? cfg.bedrockModelId : 'default'})`;
  const ttsDetail = `${cfg.tts} (${cfg.tts === 'deepgram' ? cfg.deepgramTtsVoice : cfg.tts === 'cartesia' ? 'sonic' : 'default'})`;

  console.log('┌────────────────────────────────────────────────────────┐');
  console.log('│          🎙️  WORAY VOICE PIPELINE REGISTRY             │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log(`│ STT Provider : ${pad(sttDetail, 39)} │`);
  console.log(`│ LLM Provider : ${pad(llmDetail, 39)} │`);
  console.log(`│ TTS Provider : ${pad(ttsDetail, 39)} │`);
  console.log('└────────────────────────────────────────────────────────┘');
}
