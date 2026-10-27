import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load secrets from root .env and apps/voice-backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireSecret(key: string): string {
  const v = process.env[key]?.trim();
  if (!v || v.startsWith('your_')) {
    throw new Error(
      `[Secrets] Missing required secret: ${key}. Add it to apps/voice-backend/.env — see .env.example`
    );
  }
  return v;
}

function optionalSecret(key: string): string {
  return process.env[key]?.trim() ?? '';
}

export const secrets = Object.freeze({
  livekit: {
    url: requireSecret('LIVEKIT_URL'),
    apiKey: requireSecret('LIVEKIT_API_KEY'),
    apiSecret: requireSecret('LIVEKIT_API_SECRET'),
  },
  deepgram: {
    apiKey: requireSecret('DEEPGRAM_API_KEY'),
  },
  bedrock: {
    bearerToken: requireSecret('AWS_BEARER_TOKEN_BEDROCK'),
  },
  cartesia: {
    apiKey: optionalSecret('CARTESIA_API_KEY'),
  },
  openai: {
    apiKey: optionalSecret('OPENAI_API_KEY'),
  },
  google: {
    apiKey: optionalSecret('GOOGLE_API_KEY'),
  },
  elevenlabs: {
    apiKey: optionalSecret('ELEVENLABS_API_KEY'),
  },
});
