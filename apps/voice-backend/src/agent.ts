import { fileURLToPath } from 'node:url';
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
import { testBedrockConnection } from './providers/bedrock-llm.js';
import { worayConfig } from '../woray.config.js';
import { secrets } from './config/secrets.js';
import { prompts } from '../prompts.js';

/**
 * Narrows worayConfig.llm to the bedrock variant for startup diagnostics/healthcheck.
 * Returns null when the active LLM provider is not bedrock.
 */
function activeBedrockCfg() {
  const cfg = worayConfig.llm;
  return cfg.provider === 'bedrock' ? cfg : null;
}

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
      bedrockAvailable: Boolean(secrets.bedrock.bearerToken),
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
      instructions: prompts.system,
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
    const greetingText = prompts.greeting;
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
  const sttCfg = worayConfig.stt;
  const llmCfg = worayConfig.llm;
  const ttsCfg = worayConfig.tts;

  // Startup config print (visible behavior config; excludes secrets).
  console.log('[Config] Resolved pipeline (source: apps/voice-backend/woray.config.ts)');
  console.log(JSON.stringify({
    server: worayConfig.server,
    livekit: { agentName: worayConfig.livekit.agentName, url: secrets.livekit.url },
    stt: {
      provider: sttCfg.provider,
      model: sttCfg.model,
      language: sttCfg.provider === 'deepgram' ? sttCfg.language : undefined,
    },
    llm: {
      provider: llmCfg.provider,
      region: llmCfg.provider === 'bedrock' ? llmCfg.region : undefined,
      model: llmCfg.provider === 'bedrock' ? llmCfg.modelId : llmCfg.model,
      temperature: llmCfg.temperature,
      maxTokens: llmCfg.maxTokens,
    },
    tts: {
      provider: ttsCfg.provider,
      voice: ttsCfg.provider === 'deepgram' ? ttsCfg.voice : undefined,
      model: ttsCfg.provider !== 'deepgram' ? ttsCfg.model : undefined,
      sampleRate: ttsCfg.provider === 'deepgram' ? ttsCfg.sampleRate : undefined,
    },
    prompts: { greeting: prompts.greeting, systemLength: prompts.system.length },
  }, null, 2));

  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: worayConfig.livekit.agentName,
      wsURL: secrets.livekit.url,
      apiKey: secrets.livekit.apiKey,
      apiSecret: secrets.livekit.apiSecret,
    })
  );

  // Startup Bedrock healthcheck (non-blocking; worker registers first). Fail fast on error.
  (async () => {
    const bedrockCfg = activeBedrockCfg();
    if (!bedrockCfg) {
      console.log(`[Healthcheck] Skipped: active LLM provider is "${worayConfig.llm.provider}", not bedrock.`);
      return;
    }
    try {
      await testBedrockConnection();
      console.log(`[Healthcheck] ✓ Bedrock OK: ${bedrockCfg.modelId} (${bedrockCfg.region})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Healthcheck] ✗ FATAL: ${bedrockCfg.modelId} failed -> ${msg}. Update llm.bedrock.modelId in apps/voice-backend/woray.config.ts.`);
      process.exit(1);
    }
  })();
}
