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
  AgentSessionEventTypes,
  type UserInputTranscribedEvent,
  type AgentStateChangedEvent,
  type CloseEvent,
  type ErrorEvent,
  type ConversationItemAddedEvent,
  type SpeechCreatedEvent,
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
 * Truncates text for safe diagnostic logging (never logs secrets; previews capped at 80 chars).
 */
function preview(text: unknown, max = 80): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

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
    console.log('[AgentDiag] entrypoint invoked');
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

    // ---- [AgentDiag] session lifecycle & pipeline event listeners (diagnostics only) ----
    session.on(AgentSessionEventTypes.UserInputTranscribed, (ev: UserInputTranscribedEvent) => {
      const text = ev?.transcript ?? '';
      if (text.trim().length === 0) {
        console.log('[AgentDiag] user transcript EMPTY');
      }
      console.log(
        `[AgentDiag] user transcript event: final=${ev?.isFinal} textLength=${text.length} text="${preview(text)}"`
      );
    });

    session.on(AgentSessionEventTypes.AgentStateChanged, (ev: AgentStateChangedEvent) => {
      console.log(`[AgentDiag] agent state -> ${ev?.newState} (from ${ev?.oldState})`);
    });

    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev: ConversationItemAddedEvent) => {
      const item: any = (ev as any)?.item;
      const role = item?.role ?? 'unknown';
      const text = typeof item?.textContent === 'string' ? item.textContent : (item?.rawTextContent ?? '');
      console.log(
        `[AgentDiag] conversation_item_added: role=${role} textLength=${(text ?? '').length} text="${preview(text)}"`
      );
    });

    session.on(AgentSessionEventTypes.SpeechCreated, (ev: SpeechCreatedEvent) => {
      console.log(`[AgentDiag] speech_created: source=${(ev as any)?.source ?? 'unknown'}`);
    });

    session.on(AgentSessionEventTypes.Error, (ev: ErrorEvent) => {
      const e: any = (ev as any)?.error;
      console.error(
        `[AgentDiag] session error event: type=${e?.type ?? 'unknown'} label=${e?.label ?? ''} message=${preview(e?.error?.message ?? e?.message ?? String(e), 200)} recoverable=${e?.recoverable}`
      );
    });

    session.on(AgentSessionEventTypes.Close, (ev: CloseEvent) => {
      const errObj: any = (ev as any)?.error;
      console.log(
        `[AgentDiag] session closed: reason=${(ev as any)?.reason ?? 'unknown'} error=${errObj ? preview(errObj?.error?.message ?? errObj?.message ?? String(errObj), 200) : 'none'}`
      );
    });
    // ---- end [AgentDiag] listeners ----

    // Start session inside the LiveKit room
    try {
      await session.start({
        agent,
        room: ctx.room,
      });
      console.log('[AgentDiag] session started');
    } catch (err: any) {
      console.error(`[AgentDiag] session.start() threw: ${err?.message}\n${err?.stack}`);
      throw err;
    }

    console.log('[Woray Agent] Agent session started and listening in room');

    // Announce availability immediately upon connection
    const greetingText = 'Woray online. Go ahead.';
    console.log(`[AgentDiag] greeting dispatch via session.say(), text="${preview(greetingText)}"`);
    try {
      session.say(greetingText, { allowInterruptions: true });
      console.log('[AgentDiag] greeting dispatched');
    } catch (err: any) {
      console.error(`[AgentDiag] greeting dispatch threw: ${err?.message}\n${err?.stack}`);
      throw err;
    }
  },
});

// Worker entrypoint execution via LiveKit CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: process.env.LIVEKIT_AGENT_NAME ?? 'woray-agent',
      wsURL: process.env.LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
    })
  );
}
