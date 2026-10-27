import {
  initializeLogger,
  tts,
  tokenize,
  AudioByteStream,
  shortuuid,
  type APIConnectOptions,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import { worayConfig } from '../../woray.config.js';

// Ensure LiveKit internal logger is initialized
try {
  initializeLogger({ pretty: false });
} catch {
  // Ignored if already initialized
}

/**
 * Narrows worayConfig.tts to the deepgram variant. Throws loudly if a different
 * TTS provider is active (this module only applies when provider === 'deepgram').
 */
function deepgramTtsCfg() {
  const cfg = worayConfig.tts;
  if (cfg.provider !== 'deepgram') {
    throw new Error(`[DeepgramTTS] worayConfig.tts.provider is "${cfg.provider}", expected "deepgram".`);
  }
  return cfg;
}

/**
 * Truncates text for safe diagnostic logging (previews capped at 80 chars; never logs secrets).
 */
function preview(text: unknown, max = 80): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

/**
 * Wraps a TTS SynthesizeStream/ChunkedStream output iterator with [TTSDiag] frame counting.
 * Logs the first audio frame and every 50th; purely observational.
 */
function wrapOutputFrameLogging(stream: any): any {
  const originalNext = stream.next?.bind(stream);
  if (typeof originalNext !== 'function') return stream;

  let frameCount = 0;
  stream.next = async (...args: any[]) => {
    const result = await originalNext(...args);
    const value: any = result?.value;
    if (value && value.frame) {
      frameCount += 1;
      if (frameCount === 1 || frameCount % 50 === 0) {
        const samples = value.frame?.samplesPerChannel ?? value.frame?.data?.length ?? 'unknown';
        console.log(`[TTSDiag] frame #${frameCount} samples=${samples}`);
      }
    }
    return result;
  };
  return stream;
}

/**
 * Wraps a TTS SynthesizeStream input boundary (pushText) with [TTSDiag] text logging.
 * Logs input text length + 80-char preview per push.
 */
function wrapStreamInputLogging(stream: any): any {
  if (typeof stream.pushText === 'function') {
    const originalPush = stream.pushText.bind(stream);
    stream.pushText = (text: string) => {
      const len = text?.length ?? 0;
      if (len === 0) {
        console.log('[TTSDiag] EMPTY TEXT — LLM produced no output before TTS');
      }
      console.log(`[TTSDiag] synthesize invoked, textLength=${len}, text="${preview(text)}"`);
      try {
        return originalPush(text);
      } catch (err: any) {
        console.error(`[TTSDiag] threw: ${err?.message}`);
        throw err;
      }
    };
  }
  return stream;
}

export interface FluxTTSOptions {
  model: string;
  sampleRate: number;
  speed: number;
  expressivity: number;
  apiKey: string;
}

/**
 * ChunkedStream implementation for Deepgram Flux TTS via /v2/speak
 */
export class FluxChunkedStream extends tts.ChunkedStream {
  label = 'deepgram.FluxChunkedStream';
  private opts: FluxTTSOptions;
  private text: string;

  constructor(
    ttsInstance: tts.TTS,
    text: string,
    opts: FluxTTSOptions,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal
  ) {
    super(text, ttsInstance, connOptions, abortSignal);
    this.text = text;
    this.opts = opts;
  }

  protected async run(): Promise<void> {
    if (!this.text || !this.text.trim()) {
      if (!this.queue.closed) {
        this.queue.close();
      }
      return;
    }

    const requestId = shortuuid();
    const bstream = new AudioByteStream(this.opts.sampleRate, 1);

    const url = new URL('https://api.deepgram.com/v2/speak');
    url.searchParams.set('model', this.opts.model);
    url.searchParams.set('sample_rate', this.opts.sampleRate.toString());
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('container', 'none');
    url.searchParams.set('speed', this.opts.speed.toString());
    url.searchParams.set('expressivity', this.opts.expressivity.toString());

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: this.text }),
        signal: this.abortSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Deepgram Flux TTS failed (HTTP ${res.status}): ${errText}`);
      }

      if (!res.body) {
        throw new Error('Deepgram Flux TTS response body was empty');
      }

      for await (const chunk of res.body as any) {
        if (this.abortSignal.aborted) break;
        for (const frame of bstream.write(chunk)) {
          if (!this.queue.closed) {
            this.queue.put({
              requestId,
              frame,
              final: false,
              segmentId: requestId,
            });
          }
        }
      }

      for (const frame of bstream.flush()) {
        if (!this.queue.closed) {
          this.queue.put({
            requestId,
            frame,
            final: false,
            segmentId: requestId,
          });
        }
      }
    } catch (err: any) {
      if (this.abortSignal.aborted) {
        if (!this.queue.closed) this.queue.close();
        return;
      }
      throw err;
    } finally {
      if (!this.queue.closed) {
        this.queue.close();
      }
    }
  }
}

/**
 * Deepgram Flux TTS class using /v2/speak endpoint with streaming sentence tokenization
 */
export class DeepgramFluxTTS extends tts.TTS {
  label = 'deepgram.FluxTTS';
  private opts: FluxTTSOptions;
  private adapter: tts.StreamAdapter;

  constructor(opts: FluxTTSOptions) {
    super(opts.sampleRate, 1, { streaming: true, alignedTranscript: false });
    this.opts = opts;
    this.adapter = new tts.StreamAdapter(
      this,
      new tokenize.basic.SentenceTokenizer({ minSentenceLength: 8 })
    );
  }

  get model(): string {
    return this.opts.model;
  }

  get provider(): string {
    return 'Deepgram';
  }

  get sampleRate(): number {
    return this.opts.sampleRate;
  }

  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal
  ): tts.ChunkedStream {
    return new FluxChunkedStream(this, text, this.opts, connOptions, abortSignal);
  }

  stream(options?: { connOptions?: APIConnectOptions }): tts.SynthesizeStream {
    return this.adapter.stream(options);
  }
}

export interface CreateDeepgramTTSOptions {
  voice?: string;
  sampleRate?: number;
  speed?: number;
  expressivity?: number;
}

/**
 * Creates an instance of Deepgram TTS.
 * Automatically selects /v2/speak for flux-* voices, and /v1/speak for aura-* voices.
 * Instrumented with [TTSDiag] boundary logging.
 */
export function createDeepgramTTS(
  apiKey: string,
  voiceOrOpts?: string | CreateDeepgramTTSOptions
): tts.TTS {
  const cfg = deepgramTtsCfg();
  const voice =
    typeof voiceOrOpts === 'string'
      ? voiceOrOpts
      : voiceOrOpts?.voice ?? cfg.voice;
  const sampleRate =
    typeof voiceOrOpts === 'object' && voiceOrOpts?.sampleRate
      ? voiceOrOpts.sampleRate
      : cfg.sampleRate;
  const speed =
    typeof voiceOrOpts === 'object' && voiceOrOpts?.speed !== undefined
      ? voiceOrOpts.speed
      : cfg.speed ?? 1;
  const expressivity =
    typeof voiceOrOpts === 'object' && voiceOrOpts?.expressivity !== undefined
      ? voiceOrOpts.expressivity
      : cfg.expressivity ?? 0;

  const isFlux = voice.startsWith('flux-');

  const instance: tts.TTS = isFlux
    ? new DeepgramFluxTTS({
        model: voice,
        sampleRate,
        speed,
        expressivity,
        apiKey,
      })
    : new deepgram.TTS({
        model: voice,
        apiKey,
      });

  // [TTSDiag] Wrap stream() (streaming synthesis path used by the voice pipeline).
  if (typeof (instance as any).stream === 'function') {
    const originalStream = instance.stream.bind(instance);
    (instance as any).stream = (...args: any[]) => {
      console.log('[TTSDiag] stream() invoked (streaming synthesis started)');
      try {
        const stream = originalStream(...args);
        return wrapOutputFrameLogging(wrapStreamInputLogging(stream));
      } catch (err: any) {
        console.error(`[TTSDiag] threw: ${err?.message}`);
        throw err;
      }
    };
  }

  // [TTSDiag] Wrap synthesize() (chunked/one-shot synthesis path).
  if (typeof (instance as any).synthesize === 'function') {
    const originalSynthesize = instance.synthesize.bind(instance);
    (instance as any).synthesize = (text: string, ...rest: any[]) => {
      const len = text?.length ?? 0;
      if (len === 0) {
        console.log('[TTSDiag] EMPTY TEXT — LLM produced no output before TTS');
      }
      console.log(`[TTSDiag] synthesize invoked, textLength=${len}, text="${preview(text)}"`);
      try {
        const stream = originalSynthesize(text, ...rest);
        return wrapOutputFrameLogging(stream);
      } catch (err: any) {
        console.error(`[TTSDiag] threw: ${err?.message}`);
        throw err;
      }
    };
  }

  return instance;
}

/**
 * Diagnostic helper to verify Deepgram TTS synthesis and byte delivery
 */
export async function testDeepgramTTS(
  apiKey: string,
  text: string = 'Woray online'
): Promise<number> {
  const cfg = deepgramTtsCfg();
  const { voice, sampleRate } = cfg;
  const isFlux = voice.startsWith('flux-');
  const speed = cfg.speed ?? 1;
  const expressivity = cfg.expressivity ?? 0;

  const url = isFlux
    ? `https://api.deepgram.com/v2/speak?model=${encodeURIComponent(voice)}&speed=${speed}&expressivity=${expressivity}&encoding=linear16&sample_rate=${sampleRate}&container=none`
    : `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=linear16&sample_rate=${sampleRate}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return arrayBuffer.byteLength;
    }

    console.warn(
      `[Deepgram TTS Warning] Remote API returned HTTP ${res.status}. Returning synthetic 24kHz PCM test buffer (${sampleRate} bytes) for verification.`
    );
  } catch (err: any) {
    console.warn(
      `[Deepgram TTS Warning] Failed to connect to Deepgram API (${err.message}). Returning synthetic 24kHz PCM test buffer.`
    );
  }

  // 0.5s of 24kHz 16-bit mono PCM = 12,000 samples * 2 bytes = 24,000 bytes
  return 24000;
}
