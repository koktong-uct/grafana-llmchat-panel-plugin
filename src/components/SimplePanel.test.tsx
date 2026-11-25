import React from 'react';
import { ReadableStream, TextDecoderStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SimplePanel } from './SimplePanel';

jest.mock('@grafana/data', () => ({ renderMarkdown: (text: string) => text }));
jest.mock('@grafana/ui', () => ({
  Icon: () => null,
  useStyles2: () => ({}),
  useTheme2: () => ({ isDark: false, colors: { text: { secondary: '#555' } } }),
}));
jest.mock('./DarkVeil', () => ({ DarkVeil: () => null }));

test('keeps a reply’s activity disclosure open while and after the reply streams', async () => {
  const originalFetch = globalThis.fetch;
  const originalDecoder = globalThis.TextDecoderStream;
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = jest.fn();
  let controller!: import('node:stream/web').ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
    },
  });
  const fetch = jest.fn().mockResolvedValue({
    ok: true,
    body,
    headers: { get: () => 'application/x-ndjson' },
  });
  Object.assign(globalThis, { TextDecoderStream, fetch });
  const send = (event: object) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
  const date = new Date('2026-11-24T00:00:00Z');

  try {
    render(
      <SimplePanel
        {...({
          width: 600,
          height: 400,
          options: {},
          timeRange: { from: date, to: date },
        } as unknown as React.ComponentProps<typeof SimplePanel>)}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'What is the OEE?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(fetch).toHaveBeenCalledWith(
      '/api/plugin-proxy/uct-llmchat-app/chat',
      expect.objectContaining({ method: 'POST' })
    );

    const activity = { id: 1, label: 'Query metrics · OEE' };
    await act(async () => send({ type: 'activity', activity: { ...activity, status: 'running' } }));
    const summary = await screen.findByText('Tool activity (1)');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByText('Running')).toBeTruthy();

    await act(async () => {
      send({ type: 'activity', activity: { ...activity, status: 'completed' } });
      send({ type: 'delta', text: 'First chunk' });
    });
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('First chunk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();

    await act(async () => {
      send({ type: 'delta', text: ' and the rest' });
      send({ type: 'done' });
      controller.close();
    });
    expect(screen.getByText('First chunk and the rest')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText('Tool activity (1)').closest('details')).toBe(details);
    expect(details?.open).toBe(true);
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScroll;
    Object.assign(globalThis, { TextDecoderStream: originalDecoder, fetch: originalFetch });
  }
});

test.each([
  ['http://localhost:8787/chat', '/api/plugin-proxy/uct-llmchat-app/chat'],
  ['/chat', '/api/plugin-proxy/uct-llmchat-app/chat'],
  ['  /llmchat/chat  ', '/api/plugin-proxy/uct-llmchat-app/chat'],
  ['  /custom/chat  ', '/custom/chat'],
])('sends chat to the correct URL for saved endpoint %s', async (chatEndpoint, expected) => {
  const originalFetch = globalThis.fetch;
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  const fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: 'Test response' }),
  });
  globalThis.fetch = fetch;
  HTMLElement.prototype.scrollIntoView = jest.fn();
  const date = new Date('2026-11-24T00:00:00Z');

  try {
    render(
      <SimplePanel
        {...({
          width: 600,
          height: 400,
          options: { chatEndpoint },
          timeRange: { from: date, to: date },
        } as unknown as React.ComponentProps<typeof SimplePanel>)}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'List equipment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Test response');
    expect(fetch).toHaveBeenCalledWith(expected, expect.objectContaining({ method: 'POST' }));
  } finally {
    globalThis.fetch = originalFetch;
    HTMLElement.prototype.scrollIntoView = originalScroll;
  }
});

test.each(['How is utilization across the fleet?', 'Which equipment has the lowest utilization rate?'])(
  'uses the same request when the starter is clicked or typed (%s)',
  async (question) => {
    const originalFetch = globalThis.fetch;
    const originalDecoder = globalThis.TextDecoderStream;
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = jest.fn();
    const fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/x-ndjson' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Reply"}\n{"type":"done"}\n'));
          controller.close();
        },
      }),
    }));
    Object.assign(globalThis, { TextDecoderStream, fetch });
    const props = {
      width: 600,
      height: 400,
      options: {},
      timeRange: { from: new Date('2026-11-17T00:00:00+08:00'), to: new Date('2026-11-24T00:00:00+08:00') },
    } as unknown as React.ComponentProps<typeof SimplePanel>;

    try {
      const fresh = render(<SimplePanel {...props} />);
      fireEvent.click(screen.getByRole('button', { name: question }));
      await screen.findByRole('button', { name: 'Copy' });
      fresh.unmount();

      render(<SimplePanel {...props} />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: question } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      await screen.findByRole('button', { name: 'Copy' });

      const requests = fetch.mock.calls as unknown as Array<[string, { body: string }]>;
      expect(requests[0][1].body).toBe(requests[1][1].body);
      expect(JSON.parse(requests[0][1].body)).toEqual({
        message: question,
        history: [],
        range: { from: '2026-11-16T16:00:00.000Z', to: '2026-11-23T16:00:00.000Z' },
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScroll;
      Object.assign(globalThis, { TextDecoderStream: originalDecoder, fetch: originalFetch });
    }
  }
);

test('copies tables separately and sends the latest query scope on the next turn', async () => {
  const originalFetch = globalThis.fetch;
  const originalDecoder = globalThis.TextDecoderStream;
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  HTMLElement.prototype.scrollIntoView = jest.fn();
  const range = { from: '2026-11-17T00:00:00.000Z', to: '2026-11-24T00:00:00.000Z' };
  const context = { metrics: ['utilization'], equipmentIds: ['A-01', 'A-02'], range };
  const report = {
    context,
    evidence: ['10 equipment in scope', '9 of 10 had Utilization values'],
    table: {
      caption: 'Equipment summary',
      columns: [{ label: 'Site' }, { label: 'Equipment' }, { label: 'Utilization', unit: '%' }],
      rows: [
        ['SG', 'Machine A', 8.06],
        ['SG', 'Machine B', null],
        ...Array.from({ length: 8 }, (_, i) => ['SG', `Machine ${i + 3}`, i + 12]),
      ],
      total: 10,
    },
  };
  const answer = (events: object[]) => ({
    ok: true,
    headers: { get: () => 'application/x-ndjson' },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map((event) => JSON.stringify(event) + '\n').join('')));
        controller.close();
      },
    }),
  });
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(
      answer([
        { type: 'activity', activity: { id: 1, label: 'Query metrics', status: 'completed', report } },
        {
          type: 'delta',
          text: 'Fleet overview\n\n| Equipment | Utilization |\n| :--- | :--- |\n| Machine A | 0.08% |',
        },
        { type: 'done' },
      ])
    )
    .mockImplementationOnce(async () =>
      answer([
        { type: 'delta', text: 'Follow-up\n\n| Metric | Value |\n| --- | --- |\n| OEE | 40% |' },
        { type: 'done' },
      ])
    )
    .mockImplementation(async () => answer([{ type: 'delta', text: 'Follow-up' }, { type: 'done' }]));
  Object.assign(globalThis, { TextDecoderStream, fetch });
  const props = {
    width: 600,
    height: 400,
    options: {},
    timeRange: { from: new Date('2026-11-25T00:00:00Z'), to: new Date('2026-12-02T00:00:00Z') },
  } as unknown as React.ComponentProps<typeof SimplePanel>;
  const send = (message: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: message } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  };

  try {
    render(<SimplePanel {...props} />);
    send('Summarize utilization across the fleet');
    expect(await screen.findByRole('table', { name: 'Equipment summary' })).toBeTruthy();
    expect(screen.getByText('8.06%')).toBeTruthy();
    expect(screen.queryByText(/0\.08%/)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('9 of 10 had Utilization values')).toBeTruthy();
    expect(screen.queryByText('Machine 10')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    expect(await screen.findByRole('button', { name: 'Table copied' })).toBeTruthy();
    expect(writeText.mock.calls[0][0]).toContain('| Site | Equipment | Utilization |');
    expect(writeText.mock.calls[0][0]).toContain('| SG | Machine 10 | 19% |');
    expect(writeText.mock.calls[0][0]).not.toMatch(/Fleet overview|0\.08%/);
    send('What about the same period?');
    await screen.findByText(/Follow-up/);
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    expect(request.context).toEqual(context);
    expect(request.range.from).toBe('2026-11-25T00:00:00.000Z');
    expect(request.history.at(-1).content).toBe('Fleet overview');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy table' }).at(-1)!);
    expect(writeText.mock.calls[1][0]).toBe('| Metric | Value |\n| --- | --- |\n| OEE | 40% |');

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    send('Start again');
    await screen.findByText('Follow-up');
    expect(JSON.parse(fetch.mock.calls[2][1].body).context).toBeUndefined();
  } finally {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    HTMLElement.prototype.scrollIntoView = originalScroll;
    Object.assign(globalThis, { TextDecoderStream: originalDecoder, fetch: originalFetch });
  }
});
