import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import { ChatError } from './types.ts';
import type { EmitDelta, ModelMessage, ModelTool, ToolCall } from './types.ts';

const completionPath = '/api/plugins/grafana-llm-app/resources/llm/v1/chat/completions';

export function createGrafana() {
  const baseUrl = (process.env.GRAFANA_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const caFile = process.env.GRAFANA_TLS_CA_FILE?.trim();
  const servername = process.env.GRAFANA_TLS_SERVER_NAME?.trim();
  if ((caFile || servername) && new URL(baseUrl).protocol !== 'https:') {
    throw new Error('Grafana TLS settings require an HTTPS GRAFANA_URL.');
  }
  const dispatcher =
    caFile || servername
      ? new Agent({ connect: { ca: caFile ? readFileSync(caFile) : undefined, servername } })
      : undefined;
  const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;
  const model = process.env.GRAFANA_LLM_MODEL === 'large' ? 'large' : 'base';

  async function request(body: object, signal: AbortSignal, accept = 'application/json') {
    const headers = new Headers({ Accept: accept });
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      const options = {
        dispatcher,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error' as const,
      };
      response = await fetch(baseUrl + completionPath, options);
    } catch (error) {
      signal.throwIfAborted();
      const cause = (error as { cause?: NodeJS.ErrnoException }).cause;
      console.error('Grafana connection failed:', cause?.code ?? (error as Error).name);
      if (cause?.code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause.code)) {
        throw new ChatError('Grafana HTTPS certificate verification failed. Check the backend’s Grafana TLS settings.');
      }
      throw new ChatError('Could not reach Grafana. Check GRAFANA_URL in the backend environment.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ChatError(
        `Grafana LLM app returned HTTP ${response.status}. Check its configuration and service account access.`
      );
    }
    return response;
  }

  async function stream(messages: ModelMessage[], signal: AbortSignal, emit: EmitDelta, tools?: ModelTool[]) {
    const response = await request({ model, messages, stream: true, tools }, signal, 'text/event-stream');
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel();
      throw new ChatError(
        'The Grafana LLM app did not return an SSE stream. Check that its version supports HTTP streaming.'
      );
    }
    return readCompletionStream(response.body, emit);
  }

  return { stream, close: () => dispatcher?.close() };
}

interface ToolDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

async function readCompletionStream(body: ReadableStream<Uint8Array>, emit: EmitDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let text = '';
  const calls = new Map<number, ToolCall>();
  let finished = false;

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        } else if (line === '' && data.length) {
          const payload = data.join('\n');
          data = [];
          if (payload === '[DONE]') {
            finished = true;
            break;
          }
          const chunk = JSON.parse(payload);
          if (chunk.error) {
            throw new ChatError('The Grafana LLM app reported a streaming error.');
          }
          const choice = chunk.choices?.[0];
          const content = choice?.delta?.content;
          if (typeof content === 'string' && content) {
            text += content;
            await emit(content);
          }
          for (const delta of (choice?.delta?.tool_calls ?? []) as ToolDelta[]) {
            const index = delta.index ?? 0;
            const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            call.id += delta.id ?? '';
            call.function.name += delta.function?.name ?? '';
            call.function.arguments += delta.function?.arguments ?? '';
            calls.set(index, call);
          }
          if (choice?.finish_reason === 'length') {
            throw new ChatError('The model reached its output limit before finishing.');
          }
          if (choice?.finish_reason === 'content_filter') {
            throw new ChatError('The model stopped the response because of its content filter.');
          }
          if (
            choice?.finish_reason === 'stop' ||
            choice?.finish_reason === 'tool_calls' ||
            choice?.delta?.done === true
          ) {
            finished = true;
            break;
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!finished || (!text.trim() && !calls.size)) {
    throw new ChatError('The Grafana LLM app ended the stream without a complete answer.');
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (toolCalls.some((call) => !call.id || !call.function.name)) {
    throw new ChatError('The Grafana LLM app returned an incomplete tool call.');
  }
  return { text, toolCalls };
}

export type Grafana = ReturnType<typeof createGrafana>;
