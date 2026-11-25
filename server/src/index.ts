import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createChat } from './chat.ts';
import { createGrafana } from './grafana.ts';
import { parseRange } from './time-range.ts';
import { createPostgres } from './postgres.ts';
import { readQueryContext } from './query-report.ts';
import { ChatError } from './types.ts';
import type { ChatMessage, ChatRequest, ToolActivity } from './types.ts';

const allowedOrigins = new Set(
  (process.env.CHAT_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const host = process.env.CHAT_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.CHAT_PORT || 8787);

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function parseRequest(request: IncomingMessage): Promise<ChatRequest> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new ChatError('The chat request must use application/json.');
  }
  const maxBytes = 256 * 1024;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.resume();
      throw new ChatError('The chat request is too large.');
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ChatError('The chat request is not valid JSON.');
  }

  if (typeof input?.message !== 'string' || !input.message.trim() || input.message.length > 4000) {
    throw new ChatError('Enter a message between 1 and 4,000 characters.');
  }
  const history = input.history ?? [];
  if (
    !Array.isArray(history) ||
    history.length > 12 ||
    !history.every(
      (message: Partial<ChatMessage> | null) =>
        (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string'
    )
  ) {
    throw new ChatError('The chat history is invalid.');
  }
  return {
    message: input.message.trim(),
    history: history.map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
    range: parseRange(input.range?.from, input.range?.to),
    context: readQueryContext(input.context),
  };
}

const postgres = createPostgres();
const grafana = createGrafana();
const chat = createChat(grafana, postgres);
let activeTurns = 0;

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    json(response, 403, { error: 'This Grafana origin is not allowed by the chat backend.' });
    return;
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  if (request.url === '/chat' && request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    response.end();
    return;
  }
  if (request.url === '/health/postgres' && request.method === 'GET') {
    try {
      await postgres.check();
      json(response, 200, { ok: true });
    } catch (error) {
      json(response, 503, {
        ok: false,
        error: error instanceof ChatError ? error.message : 'PostgreSQL is unavailable.',
      });
    }
    return;
  }
  if (request.url !== '/chat' || request.method !== 'POST') {
    json(response, 404, { error: 'Endpoint not found.' });
    return;
  }
  if (activeTurns >= 4) {
    json(response, 429, { error: 'The local chat server is busy. Please try again shortly.' });
    return;
  }

  activeTurns++;
  const disconnected = new AbortController();
  const timeout = AbortSignal.timeout(120_000);
  const signal = AbortSignal.any([disconnected.signal, timeout]);
  response.on('close', () => disconnected.abort());

  async function send(
    event:
      | { type: 'delta'; text: string }
      | { type: 'done' }
      | { type: 'error'; message: string }
      | { type: 'activity'; activity: ToolActivity }
  ) {
    if (!response.write(JSON.stringify(event) + '\n')) {
      await once(response, 'drain', { signal });
    }
  }

  try {
    const input = await parseRequest(request);
    signal.throwIfAborted();
    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let characters = 0;
    await chat(
      input,
      signal,
      async (text) => {
        signal.throwIfAborted();
        characters += text.length;
        if (characters > 50_000) {
          throw new ChatError('The answer exceeded the chat response limit.');
        }
        await send({ type: 'delta', text });
      },
      async (activity) => {
        signal.throwIfAborted();
        await send({ type: 'activity', activity });
      }
    );
    signal.throwIfAborted();
    await send({ type: 'done' });
    response.end();
  } catch (error) {
    if (disconnected.signal.aborted) {
      return;
    }
    const message = timeout.aborted
      ? 'The chat request timed out. Try a shorter time range or a smaller question.'
      : error instanceof ChatError
        ? error.message
        : 'The chat backend could not complete the request.';
    if (!timeout.aborted && !(error instanceof ChatError)) {
      console.error('Chat request failed:', (error as Error).name);
    }
    if (response.headersSent) {
      response.end(JSON.stringify({ type: 'error', message }) + '\n');
    } else {
      json(response, timeout.aborted ? 504 : error instanceof ChatError ? 400 : 500, { error: message });
    }
  } finally {
    activeTurns--;
  }
});

server.requestTimeout = 30_000;
server.listen(port, host, () => {
  console.log(`Chat backend listening on port ${port} at ${host}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => void Promise.allSettled([postgres.close(), grafana.close()]));
  });
}
