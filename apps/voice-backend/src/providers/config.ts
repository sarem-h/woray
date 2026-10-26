export type STTProviderName = 'deepgram' | 'openai';
export type LLMProviderName = 'bedrock' | 'openai' | 'google';
export type TTSProviderName = 'deepgram' | 'cartesia' | 'elevenlabs' | 'openai';

export function requireValidKey(envVar: string, providerLabel: string): string {
  const val = process.env[envVar]?.trim();
  if (!val || val.startsWith('your_') || val === 'placeholder') {
    throw new Error(
      `[Voice Pipeline Config Error] Selected provider "${providerLabel}" requires a valid ${envVar} in apps/voice-backend/.env, but found "${val ?? 'undefined'}".`
    );
  }
  return val;
}

export function getPipelineConfig() {
  const stt = (process.env.VOICE_STT_PROVIDER?.trim().toLowerCase() || 'deepgram') as STTProviderName;
  const llm = (process.env.VOICE_LLM_PROVIDER?.trim().toLowerCase() || 'bedrock') as LLMProviderName;
  const tts = (process.env.VOICE_TTS_PROVIDER?.trim().toLowerCase() || 'deepgram') as TTSProviderName;

  return {
    stt,
    llm,
    tts,
    awsRegion: process.env.AWS_REGION?.trim() || 'us-east-1',
    bedrockModelId: process.env.BEDROCK_MODEL_ID?.trim() || 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    deepgramSttModel: process.env.DEEPGRAM_STT_MODEL?.trim() || 'nova-2-conversationalai',
    deepgramTtsVoice: process.env.DEEPGRAM_TTS_VOICE?.trim() || 'aura-asteria-en',
    cartesiaVoiceId: process.env.CARTESIA_VOICE_ID?.trim() || 'a0e99841-438c-4a64-b679-ae501e7d6091',
  };
}
