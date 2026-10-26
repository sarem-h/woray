import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

import { createSTT, createLLM, createTTS, logActivePipelineSummary } from './providers/registry.js';
import { testBedrockConnection } from './providers/bedrock-llm.js';
import { testDeepgramTTS } from './providers/deepgram-tts.js';

async function smokeTest() {
  console.log('--- Step 1: Testing Pipeline Registry Summary ---');
  logActivePipelineSummary();

  console.log('\n--- Step 2: Instantiating Providers ---');
  const sttInstance = createSTT();
  console.log('✅ STT Instance Created:', sttInstance.label);

  const llmInstance = createLLM();
  console.log('✅ LLM Instance Created:', llmInstance.label(), 'model:', llmInstance.model);

  const ttsInstance = createTTS();
  console.log('✅ TTS Instance Created:', ttsInstance.label, 'model:', ttsInstance.model);

  console.log('\n--- Step 3: Testing Bedrock Connection ---');
  const bedrockReply = await testBedrockConnection();
  console.log('✅ Bedrock Reply:', bedrockReply.trim());

  console.log('\n--- Step 4: Testing Deepgram TTS ---');
  const ttsBytes = await testDeepgramTTS(process.env.DEEPGRAM_API_KEY || '', 'Woray online');
  console.log('✅ Deepgram TTS Bytes:', ttsBytes);

  if (ttsBytes > 1000 && bedrockReply.length > 0) {
    console.log('\n🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY!');
  } else {
    throw new Error('Smoke test criteria failed');
  }
}

smokeTest().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
