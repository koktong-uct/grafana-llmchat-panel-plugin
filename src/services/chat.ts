export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type QueryRange = { from: string; to: string };

export interface QueryContext {
  equipmentIds?: string[];
  site?: string;
  metrics: string[];
  range: QueryRange;
  baseline?: QueryRange;
}

export interface MetricTable {
  caption: string;
  columns: Array<{ label: string; unit?: '%' | 'h' | 'pp' }>;
  rows: Array<Array<string | number | null>>;
  total: number;
}

export interface ToolActivity {
  id: number;
  label: string;
  status: 'running' | 'completed' | 'failed';
  report?: { evidence: string[]; context?: QueryContext; table?: MetricTable };
}

interface ChatRequest {
  message: string;
  history: ChatMessage[];
  range: QueryRange;
  context?: QueryContext;
}

export async function streamChat(
  endpoint: string,
  request: ChatRequest,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onActivity?: (activity: ToolActivity) => void
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Chat backend returned HTTP ${response.status}.`);
  }
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    throw new Error('The chat endpoint did not return a stream.');
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error('The chat stream ended before the answer was complete.');
      }

      buffer += value;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line);
        if (event.type === 'done') {
          return;
        }
        if (event.type === 'error') {
          throw new Error(event.message);
        }
        if (event.type === 'delta' && typeof event.text === 'string') {
          onDelta(event.text);
        }
        if (event.type === 'activity') {
          const activity = event.activity;
          if (
            Number.isInteger(activity?.id) &&
            typeof activity.label === 'string' &&
            ['running', 'completed', 'failed'].includes(activity.status)
          ) {
            onActivity?.(activity);
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
