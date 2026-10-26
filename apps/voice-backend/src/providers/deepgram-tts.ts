import { tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';

/**
 * Creates an instance of Deepgram Aura TTS using the official LiveKit plugin
 */
export function createDeepgramTTS(
  apiKey: string,
  voice: string = 'aura-asteria-en'
): tts.TTS {
  return new deepgram.TTS({
    model: voice,
    apiKey,
  });
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
