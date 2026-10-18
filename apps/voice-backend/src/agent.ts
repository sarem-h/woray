import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';

dotenv.config();

/**
 * Modular Provider Factories
 * Pluggable STT (Deepgram / Whisper), LLM (OpenAI / Gemini), and TTS (Cartesia / ElevenLabs / OpenAI)
 */
function createSTT() {
  if (process.env.DEEPGRAM_API_KEY) {
    console.log('[Woray Agent] Using Deepgram Nova-2 STT for low-latency transcription');
    return new deepgram.STT({
      apiKey: process.env.DEEPGRAM_API_KEY,
      model: 'nova-2',
      language: 'en',
    });
  }

  console.log('[Woray Agent] Falling back to OpenAI Whisper STT');
  return new openai.STT({
    apiKey: process.env.OPENAI_API_KEY,
    language: 'en',
  });
}

function createLLM() {
  if (process.env.OPENAI_API_KEY) {
    console.log('[Woray Agent] Using OpenAI GPT-4o-mini LLM');
    return new openai.LLM({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      temperature: 0.7,
    });
  }

  if (process.env.GOOGLE_API_KEY) {
    console.log('[Woray Agent] Using Google Gemini 2.0 Flash LLM');
    return new google.LLM({
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-2.0-flash',
    });
  }

  throw new Error('No LLM API key configured (specify OPENAI_API_KEY or GOOGLE_API_KEY)');
}

function createTTS() {
  if (process.env.CARTESIA_API_KEY) {
    console.log('[Woray Agent] Using Cartesia Sonic TTS (<150ms TTFB)');
    return new cartesia.TTS({
      apiKey: process.env.CARTESIA_API_KEY,
      model: 'sonic-english',
      voice: '79a125e8-cd45-4c13-8a67-188112f4dd22', // Conversational natural voice
    });
  }

  if (process.env.ELEVENLABS_API_KEY) {
    console.log('[Woray Agent] Using ElevenLabs Turbo v2.5 TTS');
    return new elevenlabs.TTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      model: 'eleven_turbo_v2_5',
    });
  }

  console.log('[Woray Agent] Falling back to OpenAI TTS');
  return new openai.TTS({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'tts-1',
    voice: 'alloy',
  });
}

/**
 * LiveKit Agent Worker Definition
 */
export default defineAgent({
  // Prewarm Silero VAD neural network on startup so first turn is zero-lag
  prewarm: async (proc: JobProcess) => {
    console.log('[Woray Agent] Prewarming Silero VAD model...');
    proc.userData.vad = await silero.VAD.load();
    console.log('[Woray Agent] Silero VAD loaded.');
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log(`[Woray Agent] Joined room: ${ctx.room.name}`);

    const vad = ctx.proc.userData.vad as silero.VAD;

    // Define Assistant persona & conversational instructions
    const agent = new voice.Agent({
      instructions: `You are Woray, a fast, proactive, natural conversational voice assistant triggered by the iPhone 17 Action Button.
Keep spoken responses brief, natural, direct, and under 2-3 sentences.
Do not use markdown lists, bullet points, asterisks, or formatting that sounds awkward when spoken.
Silero Voice Activity Detection is actively monitoring user speech: if the user interrupts or starts speaking, you will yield immediately.`,
    });

    // Assemble turn-taking pipeline with barge-in interruption enabled
    const session = new voice.AgentSession({
      vad,
      stt: createSTT(),
      llm: createLLM(),
      tts: createTTS(),
      turnHandling: {
        interruption: {
          mode: 'vad',
          minDuration: 0.4,
          discardAudioIfUninterruptible: true,
        },
      },
    });

    // Start session inside the LiveKit room
    await session.start({
      agent,
      room: ctx.room,
    });

    console.log('[Woray Agent] Agent session started and listening in room');

    // Announce availability
    session.say('Woray connected. What can I do for you?');
  },
});

// Worker entrypoint execution via LiveKit CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
      wsURL: process.env.LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
    })
  );
}
