import {
  DEFAULT_API_CONNECT_OPTIONS,
  type APIConnectOptions,
  llm,
} from '@livekit/agents';

export interface BedrockLLMOptions {
  modelId?: string;
  region?: string;
  bearerToken?: string;
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

export class BedrockLLMStream extends llm.LLMStream {
  private modelId: string;
  private region: string;
  private bearerToken: string;

  constructor(
    llmInstance: BedrockLLM,
    opts: {
      chatCtx: llm.ChatContext;
      toolCtx?: llm.ToolContextLike;
      connOptions: APIConnectOptions;
      modelId: string;
      region: string;
      bearerToken: string;
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
  }

  protected async run(): Promise<void> {
    const { system, messages } = formatBedrockMessages(this.chatCtx);

    const payload: any = { messages };
    if (system.length > 0) {
      payload.system = system;
    }

    let activeModel = this.modelId;
    const fallbackModel = 'amazon.nova-lite-v1:0';

    const sendRequest = async (model: string) => {
      const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(model)}/converse-stream`;
      return fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: this.abortController.signal,
      });
    };

    let res: Response;
    try {
      res = await sendRequest(activeModel);
    } catch (err: any) {
      if (this.abortController.signal.aborted) return;
      throw err;
    }

    if (!res.ok) {
      const status = res.status;
      const errText = await res.text().catch(() => '');

      if ((status === 404 || status === 400) && activeModel !== fallbackModel) {
        console.warn(`[BedrockLLM] Model "${activeModel}" returned HTTP ${status}. Falling back to ${fallbackModel}...`);
        activeModel = fallbackModel;
        res = await sendRequest(activeModel);
        if (!res.ok) {
          throw new Error(`Bedrock ConverseStream error (${res.status}): ${await res.text().catch(() => '')}`);
        }
      } else {
        // Fallback to non-streaming /converse endpoint
        const nonStreamUrl = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(activeModel)}/converse`;
        const fallbackRes = await fetch(nonStreamUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: this.abortController.signal,
        });

        if (fallbackRes.ok) {
          const json: any = await fallbackRes.json();
          const text = json.output?.message?.content?.[0]?.text;
          if (text) {
            const chunkId = `bedrock-${Date.now()}`;
            this.queue.put({
              id: chunkId,
              delta: { role: 'assistant', content: text },
            });
          }
          return;
        }

        throw new Error(`Bedrock HTTP ${status}: ${errText}`);
      }
    }

    if (!res.body) {
      throw new Error('Bedrock ConverseStream response body was empty');
    }

    // Binary AWS EventStream framing accumulator
    let accumulator = Buffer.alloc(0);
    const chunkId = `bedrock-${Date.now()}`;

    for await (const chunk of res.body as any) {
      if (this.abortController.signal.aborted) break;
      accumulator = Buffer.concat([accumulator, Buffer.from(chunk)]);

      while (accumulator.length >= 12) {
        const totalByteLength = accumulator.readUInt32BE(0);
        if (accumulator.length < totalByteLength) {
          break;
        }

        const headersByteLength = accumulator.readUInt32BE(4);
        const payloadBuf = accumulator.subarray(12 + headersByteLength, totalByteLength - 4);
        accumulator = accumulator.subarray(totalByteLength);

        if (payloadBuf.length > 0) {
          try {
            const frameJson = JSON.parse(payloadBuf.toString('utf8'));
            const textDelta =
              frameJson.delta?.text ??
              frameJson.contentBlockDelta?.delta?.text ??
              (typeof frameJson.text === 'string' ? frameJson.text : undefined);

            if (textDelta) {
              this.queue.put({
                id: chunkId,
                delta: {
                  role: 'assistant',
                  content: textDelta,
                },
              });
            }

            if (frameJson.metadata?.usage) {
              this.queue.put({
                id: chunkId,
                usage: {
                  promptTokens: frameJson.metadata.usage.inputTokens || 0,
                  completionTokens: frameJson.metadata.usage.outputTokens || 0,
                  totalTokens: frameJson.metadata.usage.totalTokens || 0,
                  promptCachedTokens: 0,
                },
              });
            }
          } catch {
            // Non-JSON or framing control frame
          }
        }
      }
    }
  }
}

export class BedrockLLM extends llm.LLM {
  private opts: Required<BedrockLLMOptions>;

  constructor(opts?: BedrockLLMOptions) {
    super();
    this.opts = {
      modelId: opts?.modelId || process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0',
      region: opts?.region || process.env.AWS_REGION || 'us-east-1',
      bearerToken: opts?.bearerToken || process.env.AWS_BEARER_TOKEN_BEDROCK || '',
    };

    if (!this.opts.bearerToken) {
      throw new Error('[BedrockLLM] AWS_BEARER_TOKEN_BEDROCK must be configured in environment or options.');
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
    return new BedrockLLMStream(this, {
      chatCtx,
      toolCtx,
      connOptions,
      modelId: this.opts.modelId,
      region: this.opts.region,
      bearerToken: this.opts.bearerToken,
    });
  }
}

/**
 * Diagnostic helper to test Bedrock Bearer Token connectivity
 */
export async function testBedrockConnection(): Promise<string> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (!token) throw new Error('AWS_BEARER_TOKEN_BEDROCK is not defined');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const configuredModel = process.env.BEDROCK_MODEL_ID?.trim() || 'amazon.nova-lite-v1:0';
  const fallbackModel = 'amazon.nova-lite-v1:0';

  const testPayload = {
    messages: [{ role: 'user', content: [{ text: 'Respond with "Woray online" in two words.' }] }],
  };

  async function callModel(targetModel: string): Promise<string> {
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(targetModel)}/converse`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      if ((res.status === 404 || res.status === 400) && targetModel !== fallbackModel) {
        console.warn(`[BedrockLLM] Model ${targetModel} returned HTTP ${res.status}. Falling back to ${fallbackModel}...`);
        return callModel(fallbackModel);
      }
      throw new Error(`Bedrock HTTP ${res.status}: ${errText}`);
    }

    const json: any = await res.json();
    return json.output?.message?.content?.[0]?.text || '';
  }

  return callModel(configuredModel);
}
