import {
  DEFAULT_API_CONNECT_OPTIONS,
  type APIConnectOptions,
  llm,
} from '@livekit/agents';
import { worayConfig } from '../../woray.config.js';
import { secrets } from '../config/secrets.js';

/**
 * Narrows worayConfig.llm to the bedrock variant (this module is only used when
 * provider === 'bedrock'). Throws loudly if misconfigured.
 */
function bedrockCfg() {
  const cfg = worayConfig.llm;
  if (cfg.provider !== 'bedrock') {
    throw new Error(`[BedrockLLM] worayConfig.llm.provider is "${cfg.provider}", expected "bedrock".`);
  }
  return cfg;
}

export interface BedrockLLMOptions {
  modelId?: string;
  region?: string;
  bearerToken?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Normalizes ChatContext into Bedrock Converse API format:
 * - Extracts developer/system messages into system array
 * - Enforces strictly alternating user/assistant turns
 * - Pre-populates a user turn if none exists
 * - Strips empty messages
 */
function formatBedrockMessages(chatCtx: llm.ChatContext) {
  const system: Array<{ text: string }> = [];
  const rawMessages: Array<{ role: 'user' | 'assistant'; text: string }> = [];

  for (const item of chatCtx.items) {
    if (item.type === 'message') {
      const text = (item.textContent || item.rawTextContent || '').trim();
      if (!text) continue;

      if (item.role === 'system' || (item.role as any) === 'developer') {
        system.push({ text });
      } else if (item.role === 'user' || item.role === 'assistant') {
        rawMessages.push({ role: item.role, text });
      }
    }
  }

  // Bedrock requires strictly alternating user/assistant turns
  const collapsed: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> = [];
  for (const item of rawMessages) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].role === item.role) {
      collapsed[collapsed.length - 1].content[0].text += `\n\n${item.text}`;
    } else {
      collapsed.push({
        role: item.role,
        content: [{ text: item.text }],
      });
    }
  }

  // First message must be a user turn
  if (collapsed.length === 0) {
    collapsed.push({
      role: 'user',
      content: [{ text: 'Hello, introduce yourself briefly.' }],
    });
  } else if (collapsed[0].role !== 'user') {
    collapsed.unshift({
      role: 'user',
      content: [{ text: 'Hello' }],
    });
  }

  return { system, messages: collapsed };
}

/**
 * Truncates text for safe diagnostic logging (previews capped, never logs secrets).
 */
function truncate(text: unknown, max = 80): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

/**
 * Parses the AWS EventStream frame headers (read-only, diagnostic) to extract the
 * `:event-type` discriminant (e.g. contentBlockDelta, messageStop, metadata,
 * throttlingException, internalServerException). Returns 'unknown' when unparseable.
 *
 * AWS EventStream header encoding per frame: repeated [nameLen:1][name][valueType:1][value].
 * valueType 7 = string (2-byte BE length + UTF-8 bytes).
 */
function parseEventType(headerBuf: Buffer): string {
  try {
    let offset = 0;
    let eventType = 'unknown';
    while (offset < headerBuf.length) {
      const nameLen = headerBuf.readUInt8(offset);
      offset += 1;
      const name = headerBuf.subarray(offset, offset + nameLen).toString('utf8');
      offset += nameLen;
      const valueType = headerBuf.readUInt8(offset);
      offset += 1;
      if (valueType === 7) {
        // string
        const len = headerBuf.readUInt16BE(offset);
        offset += 2;
        const value = headerBuf.subarray(offset, offset + len).toString('utf8');
        offset += len;
        if (name === ':event-type') eventType = value;
      } else if (valueType === 0 || valueType === 1) {
        // bool true/false — no payload
      } else if (valueType === 2) {
        offset += 1; // byte
      } else if (valueType === 3) {
        offset += 2; // short
      } else if (valueType === 4) {
        offset += 4; // int
      } else if (valueType === 5) {
        offset += 8; // long
      } else if (valueType === 6) {
        const len = headerBuf.readUInt16BE(offset);
        offset += 2 + len; // bytes
      } else if (valueType === 8) {
        offset += 8; // timestamp
      } else if (valueType === 9) {
        offset += 16; // uuid
      } else {
        break;
      }
    }
    return eventType;
  } catch {
    return 'unknown';
  }
}

export class BedrockLLMStream extends llm.LLMStream {
  private modelId: string;
  private region: string;
  private bearerToken: string;
  private temperature: number;
  private maxTokens: number;

  constructor(
    llmInstance: BedrockLLM,
    opts: {
      chatCtx: llm.ChatContext;
      toolCtx?: llm.ToolContextLike;
      connOptions: APIConnectOptions;
      modelId: string;
      region: string;
      bearerToken: string;
      temperature: number;
      maxTokens: number;
    }
  ) {
    super(llmInstance, {
      chatCtx: opts.chatCtx,
      toolCtx: opts.toolCtx,
      connOptions: opts.connOptions,
    });
    this.modelId = opts.modelId;
    this.region = opts.region;
    this.bearerToken = opts.bearerToken;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
  }

  protected async run(): Promise<void> {
    const { system, messages } = formatBedrockMessages(this.chatCtx);

    const payload: any = {
      messages,
      inferenceConfig: {
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      },
    };
    if (system.length > 0) {
      payload.system = system;
    }

    // Single configured model. Fail hard and loud on any non-2xx.
    const activeModel = this.modelId;

    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(activeModel)}/converse-stream`;

    // [BedrockDiag] endpoint identification (path + protocol only; no query string, no headers).
    console.log(
      `[BedrockDiag] endpoint=/model/${activeModel}/converse-stream protocol=converse-stream region=${this.region}`
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      });
    } catch (err: any) {
      if (this.abortController.signal.aborted) return;
      console.error(`[BedrockDiag] stream threw: ${err?.message}\n${err?.stack}`);
      throw err;
    }

    // [BedrockDiag] HTTP response status + content type.
    console.log(
      `[BedrockDiag] http status=${res.status} contentType=${res.headers.get('content-type') ?? 'unknown'}`
    );

    if (!res.ok) {
      const status = res.status;
      const bodyText = await res.text().catch(() => '');
      console.error(`[BedrockDiag] non-200 response body: ${truncate(bodyText, 300)}`);
      throw new Error(
        `[BedrockLLM] FATAL: model ${activeModel} returned HTTP ${status}. Body: ${truncate(bodyText, 300)}`
      );
    }

    if (!res.body) {
      throw new Error('Bedrock ConverseStream response body was empty');
    }

    // Binary AWS EventStream framing accumulator
    let accumulator = Buffer.alloc(0);
    const chunkId = `bedrock-${Date.now()}`;
    let chunkCount = 0;
    let totalTextLength = 0;

    try {
      for await (const chunk of res.body as any) {
        if (this.abortController.signal.aborted) break;
        accumulator = Buffer.concat([accumulator, Buffer.from(chunk)]);

        while (accumulator.length >= 12) {
          const totalByteLength = accumulator.readUInt32BE(0);
          if (accumulator.length < totalByteLength) {
            break;
          }

          const headersByteLength = accumulator.readUInt32BE(4);
          const headerBuf = accumulator.subarray(12, 12 + headersByteLength);
          const payloadBuf = accumulator.subarray(12 + headersByteLength, totalByteLength - 4);
          accumulator = accumulator.subarray(totalByteLength);

          // [BedrockDiag] stream event discriminant (from EventStream headers).
          const eventType = headersByteLength > 0 ? parseEventType(headerBuf) : 'unknown';

          if (payloadBuf.length > 0) {
            try {
              const frameJson = JSON.parse(payloadBuf.toString('utf8'));

              // [BedrockDiag] detect stream-level exception/error events emitted inside a 200 stream.
              const isErrorEvent =
                /exception|error|fault/i.test(eventType) ||
                frameJson.throttlingException ||
                frameJson.internalServerException ||
                frameJson.modelStreamErrorException ||
                frameJson.serviceUnavailableException ||
                frameJson.validationException;
              if (isErrorEvent) {
                console.error(
                  `[BedrockDiag] stream error event: ${eventType} message=${truncate(frameJson.message ?? frameJson.error?.message ?? JSON.stringify(frameJson), 200)}`
                );
                throw new Error(
                  `Bedrock stream error event "${eventType}": ${truncate(frameJson.message ?? JSON.stringify(frameJson), 200)}`
                );
              }

              const textDelta =
                frameJson.delta?.text ??
                frameJson.contentBlockDelta?.delta?.text ??
                (typeof frameJson.text === 'string' ? frameJson.text : undefined);

              // Log every parsed event's discriminant/type name only.
              console.log(`[BedrockDiag] stream event: ${eventType}`);

              if (textDelta) {
                console.log(`[BedrockDiag] text delta length=${textDelta.length}`);
                totalTextLength += textDelta.length;
                chunkCount += 1;
                this.queue.put({
                  id: chunkId,
                  delta: {
                    role: 'assistant',
                    content: textDelta,
                  },
                });
                if (chunkCount === 1 || chunkCount % 10 === 0) {
                  console.log(`[BedrockDiag] chunk #${chunkCount} type=delta textDeltaLength=${textDelta.length}`);
                }
              }

              if (frameJson.metadata?.usage) {
                chunkCount += 1;
                this.queue.put({
                  id: chunkId,
                  usage: {
                    promptTokens: frameJson.metadata.usage.inputTokens || 0,
                    completionTokens: frameJson.metadata.usage.outputTokens || 0,
                    totalTokens: frameJson.metadata.usage.totalTokens || 0,
                    promptCachedTokens: 0,
                  },
                });
                if (chunkCount === 1 || chunkCount % 10 === 0) {
                  console.log(`[BedrockDiag] chunk #${chunkCount} type=usage textDeltaLength=0`);
                }
              }
            } catch (parseErr: any) {
              // Re-throw stream error events; otherwise treat as non-JSON/framing control frame.
              if (parseErr && String(parseErr.message || '').startsWith('Bedrock stream error event')) {
                throw parseErr;
              }
              // Non-JSON or framing control frame
            }
          }
        }
      }

      // [BedrockDiag] end-of-stream: the framework's LLMStream mainTask closes this.queue in a
      // finally block after run() returns, which unblocks the pipeline consumer automatically.
      console.log(
        `[BedrockDiag] stream iterator exhausted after ${chunkCount} chunks, totalTextLength=${totalTextLength}`
      );
    } catch (err: any) {
      if (this.abortController.signal.aborted) return;
      console.error(`[BedrockDiag] stream threw: ${err?.message}\n${err?.stack}`);
      throw err;
    }
  }
}

export class BedrockLLM extends llm.LLM {
  private opts: Required<BedrockLLMOptions>;

  constructor(opts?: BedrockLLMOptions) {
    super();
    const cfg = bedrockCfg();
    this.opts = {
      modelId: opts?.modelId || cfg.modelId,
      region: opts?.region || cfg.region,
      bearerToken: opts?.bearerToken || secrets.bedrock.bearerToken,
      temperature: opts?.temperature ?? cfg.temperature,
      maxTokens: opts?.maxTokens ?? cfg.maxTokens,
    };

    if (!this.opts.bearerToken) {
      throw new Error('[BedrockLLM] AWS_BEARER_TOKEN_BEDROCK must be configured (see src/config/secrets.ts).');
    }
  }

  label(): string {
    return 'bedrock.LLM';
  }

  get model(): string {
    return this.opts.modelId;
  }

  get provider(): string {
    return 'aws-bedrock';
  }

  chat({
    chatCtx,
    toolCtx,
    connOptions = DEFAULT_API_CONNECT_OPTIONS,
  }: {
    chatCtx: llm.ChatContext;
    toolCtx?: llm.ToolContextLike;
    connOptions?: APIConnectOptions;
    parallelToolCalls?: boolean;
    toolChoice?: llm.ToolChoice;
    extraKwargs?: Record<string, unknown>;
  }): llm.LLMStream {
    // [BedrockDiag] chat() invoked — capture message count and last user text length.
    try {
      const msgs = formatBedrockMessages(chatCtx).messages;
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      const lastUserText = lastUser?.content?.[0]?.text ?? '';
      console.log(
        `[BedrockDiag] chat() invoked, messages=${msgs.length}, lastUserTextLength=${lastUserText.length}` +
          (lastUserText ? `, lastUserText="${truncate(lastUserText)}"` : '')
      );
    } catch {
      // Diagnostic-only; never block chat() on formatting.
    }

    return new BedrockLLMStream(this, {
      chatCtx,
      toolCtx,
      connOptions,
      modelId: this.opts.modelId,
      region: this.opts.region,
      bearerToken: this.opts.bearerToken,
      temperature: this.opts.temperature,
      maxTokens: this.opts.maxTokens,
    });
  }
}

/**
 * Diagnostic helper to test Bedrock Bearer Token connectivity.
 * Sends a raw non-streaming ping to the single configured model.
 * Throws on any non-200 with status and body snippet.
 */
export async function testBedrockConnection(): Promise<string> {
  const cfg = bedrockCfg();
  const token = secrets.bedrock.bearerToken;
  if (!token) throw new Error('AWS_BEARER_TOKEN_BEDROCK is not defined (see src/config/secrets.ts)');

  const url = `https://bedrock-runtime.${cfg.region}.amazonaws.com/model/${encodeURIComponent(cfg.modelId)}/converse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: 'ping' }] }],
      inferenceConfig: { maxTokens: 5 },
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(
      `[BedrockLLM] FATAL: model ${cfg.modelId} returned HTTP ${res.status}. Body: ${truncate(bodyText, 300)}`
    );
  }

  const json: any = await res.json();
  return json.output?.message?.content?.[0]?.text || '';
}
