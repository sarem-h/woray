import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();
import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
  llm,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import {
  createSTT,
  createLLM,
  createTTS,
  logActivePipelineSummary,
} from './providers/registry.js';

dotenv.config();

/**
 * Built-in Tools for Woray Agent
 */
const getCurrentTimeTool = llm.tool({
  name: 'get_current_time',
  description: 'Returns the current local date, time, and timezone of the system.',
  execute: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      formatted: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});

const getSystemStatusTool = llm.tool({
  name: 'get_system_status',
  description: 'Returns the health, uptime, and operational diagnostics of the Woray assistant.',
  execute: async () => {
    return {
      status: 'operational',
      uptimeSeconds: Math.floor(process.uptime()),
      platform: process.platform,
      nodeVersion: process.version,
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      bedrockAvailable: Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK),
    };
  },
});

/**
 * LiveKit Agent Worker Definition
 */
export default defineAgent({
  // Prewarm Silero VAD neural network on startup so first turn is zero-lag
  prewarm: async (proc: JobProcess) => {
    logActivePipelineSummary();
    console.log('[Woray Agent] Prewarming Silero VAD model...');
    proc.userData.vad = await silero.VAD.load();
    console.log('[Woray Agent] Silero VAD loaded.');
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log(`[Woray Agent] Joined room: ${ctx.room.name}`);

    const vad = ctx.proc.userData.vad as silero.VAD;

    // Define Assistant persona & conversational instructions with functional tools
    const agent = new voice.Agent({
      instructions: `You are Woray, a fast, proactive, natural conversational voice assistant triggered by the iPhone 17 Action Button.
Keep spoken responses brief, natural, direct, and under 2-3 sentences.
Do not use markdown lists, bullet points, asterisks, or formatting that sounds awkward when spoken.
Silero Voice Activity Detection is actively monitoring user speech: if the user interrupts or starts speaking, you will yield immediately.
You have access to tools: get_current_time for checking current time or date, and get_system_status for reporting assistant health and status.`,
      tools: [getCurrentTimeTool, getSystemStatusTool],
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

    // Announce availability immediately upon connection
    session.say('Woray online. Go ahead.', { allowInterruptions: true });
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
