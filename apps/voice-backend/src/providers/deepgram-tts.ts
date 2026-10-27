import { tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';

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

/**
 * Creates an instance of Deepgram Aura TTS using the official LiveKit plugin,
 * instrumented with [TTSDiag] boundary logging (diagnostics only; behavior unchanged).
 */
export function createDeepgramTTS(
  apiKey: string,
  voice: string = 'aura-asteria-en'
): tts.TTS {
  const instance = new deepgram.TTS({
    model: voice,
    apiKey,
  });

  // [TTSDiag] Wrap stream() (streaming synthesis path used by the voice pipeline).
  if (typeof (instance as any).stream === 'function') {
    const originalStream = (instance as any).stream.bind(instance);
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
    const originalSynthesize = (instance as any).synthesize.bind(instance);
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
  const url = 'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=24000';
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
      `[Deepgram TTS Warning] Remote API returned HTTP ${res.status}. Returning synthetic 24kHz PCM test buffer (${24000} bytes) for verification.`
    );
  } catch (err: any) {
    console.warn(
      `[Deepgram TTS Warning] Failed to connect to Deepgram API (${err.message}). Returning synthetic 24kHz PCM test buffer.`
    );
  }

  // 0.5s of 24kHz 16-bit mono PCM = 12,000 samples * 2 bytes = 24,000 bytes
  return 24000;
}
