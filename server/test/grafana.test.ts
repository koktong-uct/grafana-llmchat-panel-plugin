import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGrafana } from '../src/grafana.ts';

test('forwards complete SSE events immediately, including a split multibyte character', async (t) => {
  const event = 'data: {"choices":[{"delta":{"content":"等待"}}]}\r\n\r\n';
  const bytes = new TextEncoder().encode(event);
  const split = bytes.indexOf(0xe7) + 1;
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: { body: string }) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(
      new ReadableStream({
        start: (controller) => {
          upstream = controller;
        },
      }),
      {
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  });
  let firstDelta!: (text: string) => void;
  const firstText = new Promise<string>((resolve) => {
    firstDelta = resolve;
  });
  const stream = createGrafana().stream([], AbortSignal.timeout(3000), async (text) => firstDelta(text));
  upstream.enqueue(bytes.subarray(0, split));
  upstream.enqueue(bytes.subarray(split));

  assert.equal(await firstText, '等待');
  upstream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
  upstream.close();
  await stream;
});

test('rejects an interrupted upstream stream after forwarding its partial text', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
  );
  const deltas: string[] = [];
  await assert.rejects(
    createGrafana().stream([], AbortSignal.timeout(3000), async (text) => {
      deltas.push(text);
    }),
    /without a complete answer/
  );
  assert.deepEqual(deltas, ['Partial answer']);
});

test('reassembles streamed tool arguments without emitting them as answer text', async (t) => {
  const frames = [
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'call-1', function: { name: 'get_metrics', arguments: '{"metrics":' } }],
          },
        },
      ],
    },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '["oee"]}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
  );
  const result = await createGrafana().stream([], AbortSignal.timeout(3000), async () => {
    assert.fail('tool fragments must not be emitted');
  });
  assert.deepEqual(result.toolCalls, [
    { id: 'call-1', type: 'function', function: { name: 'get_metrics', arguments: '{"metrics":["oee"]}' } },
  ]);
});
