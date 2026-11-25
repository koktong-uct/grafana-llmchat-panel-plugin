import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChat } from '../src/chat.ts';
import { createToolRunner } from '../src/chat-tools.ts';
import type { Grafana } from '../src/grafana.ts';
import type { Equipment, Postgres } from '../src/postgres.ts';
import type { ModelMessage, ToolActivity, ToolCall } from '../src/types.ts';

const machine: Equipment = {
  equipment_id: 'A-001',
  equipment: 'Machine A',
  site: 'SG',
  eqp_type: 'Tool',
  eqp_serial_no: 'SN-123',
  plan_prod_time_min: 480,
  ideal_cycle_time_min: 0.5,
  oee_threshold: 80,
  utilization_threshold: null,
};

test('returns a tool error to the model and lets it recover with a two-period comparison', async () => {
  function call(id: string, name: string, args: object): ToolCall {
    return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  }
  const from = '2026-11-01T00:00:00+08:00';
  const to = '2026-11-08T00:00:00+08:00';
  const later = '2026-11-15T00:00:00+08:00';
  const first = call('1', 'get_metrics', { metrics: ['oee'], equipment_ids: ['wrong'] });
  const lookup = call('2', 'find_equipment', { query: 'Machine A' });
  const earlier = call('3', 'get_metrics', { metrics: ['oee'], equipment_ids: ['A-001'], from, to });
  const newer = call('4', 'get_metrics', { metrics: ['oee'], equipment_ids: ['A-001'], from: to, to: later });
  const rounds = [[first], [lookup], [earlier, newer], []];
  const transcript: ModelMessage[][] = [];
  const grafana: Grafana = {
    async stream(messages, _signal, emit) {
      transcript.push([...messages]);
      const toolCalls = rounds.shift()!;
      const text = toolCalls.length ? '' : 'OEE fell by 5 percentage points.';
      if (text) {
        await emit(text);
      }
      return { text, toolCalls };
    },
    close: () => undefined,
  };
  const queried: string[] = [];
  const postgres: Postgres = {
    async check() {},
    async listEquipment() {
      return [machine];
    },
    async getMetricRows(metric, range, ids) {
      assert.equal(metric, 'oee');
      assert.deepEqual(ids, ['A-001']);
      queried.push(range.from.toISOString());
      return [{ oee: queried.length === 1 ? 80 : 75 }];
    },
    async getDiagnosticRows() {
      return { rows: [], truncated: false };
    },
    async getFleetDiagnosticRows() {
      return [];
    },
    close: () => undefined,
  };
  const deltas: string[] = [];
  const activity: ToolActivity[] = [];
  await createChat(grafana, postgres)(
    { message: 'Compare OEE for Machine A', history: [], range: { from: new Date(from), to: new Date(to) } },
    AbortSignal.timeout(3000),
    async (delta) => {
      deltas.push(delta);
    },
    async (step) => {
      activity.push(step);
    }
  );
  assert.match(transcript[1].at(-1)!.content!, /equipment IDs were not found/);
  assert.deepEqual(queried, [new Date(from).toISOString(), new Date(to).toISOString()]);
  assert.deepEqual(deltas, ['OEE fell by 5 percentage points.']);
  assert.deepEqual(
    activity.map(({ id, status }) => [id, status]),
    [
      [1, 'running'],
      [1, 'failed'],
      [2, 'running'],
      [2, 'completed'],
      [3, 'running'],
      [3, 'completed'],
      [4, 'running'],
      [4, 'completed'],
    ]
  );
  assert.equal(activity[0].label, 'Query metrics · OEE');
  assert.equal(activity[2].label, 'Look up equipment');
});

test('looks up configuration by serial number and filters by site and equipment type', async () => {
  const postgres = {
    async listEquipment() {
      return [machine, { ...machine, equipment_id: 'B-001', site: 'MY', eqp_type: 'Equipment' }];
    },
  } as Postgres;
  const runTool = createToolRunner(
    postgres,
    { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') },
    AbortSignal.timeout(3000)
  );
  const result = await runTool({
    id: '1',
    type: 'function',
    function: {
      name: 'find_equipment',
      arguments: JSON.stringify({ query: 'sn123', site: 'sg', equipment_type: 'tool' }),
    },
  });
  assert.deepEqual(result, { sites: ['SG'], equipment: [machine], matched: 1, truncated: false });
});

test('streams a direct answer without looking up manufacturing data', async () => {
  const grafana: Grafana = {
    async stream(_messages, _signal, emit) {
      const text = 'OEE means Overall Equipment Effectiveness.';
      await emit(text);
      return { text, toolCalls: [] };
    },
    close: () => undefined,
  };
  const postgres = {
    async listEquipment() {
      assert.fail('a general question should not query PostgreSQL');
    },
  } as Postgres;
  const deltas: string[] = [];
  await createChat(grafana, postgres)(
    {
      message: 'What does OEE mean?',
      history: [],
      range: { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') },
    },
    AbortSignal.timeout(3000),
    async (delta) => {
      deltas.push(delta);
    }
  );
  assert.deepEqual(deltas, ['OEE means Overall Equipment Effectiveness.']);
});

test('ranks period changes across the full fleet before limiting displayed rows', async () => {
  const equipment = Array.from({ length: 65 }, (_, i) => ({ ...machine, equipment_id: `ID-${i}` }));
  const from = new Date('2026-11-02T00:00:00Z');
  const to = new Date('2026-11-03T00:00:00Z');
  const postgres = {
    async listEquipment() {
      return equipment;
    },
    async getMetricRows(metric, range, ids) {
      assert.equal(metric, 'idle_hours');
      assert.equal(ids.length, 65);
      return ids.map((equipment_id, i) => ({
        equipment_id,
        idle_hours: range.from.getTime() === from.getTime() ? (i === 0 ? null : i === 1 ? 0 : i) : 0,
      }));
    },
  } as Postgres;
  const run = createToolRunner(postgres, { from, to }, AbortSignal.timeout(3000));
  const result = (await run({
    id: '1',
    type: 'function',
    function: {
      name: 'get_metrics',
      arguments: JSON.stringify({
        metrics: ['idle_hours'],
        comparison_from: '2026-11-01T00:00:00Z',
        comparison_to: from.toISOString(),
        rank_by_change: true,
      }),
    },
  })) as {
    results: Array<{
      evaluated: number;
      measured: number;
      truncated: boolean;
      rows: Array<{ equipment_id: string }>;
      highest: { equipment_id: string; value: number };
      lowest: { equipment_id: string; value: number };
    }>;
  };
  assert.equal(result.results[0].evaluated, 65);
  assert.equal(result.results[0].truncated, true);
  assert.equal(result.results[0].rows[0].equipment_id, 'ID-64');
  assert.equal(result.results[0].measured, 64);
  assert.equal(result.results[0].highest.equipment_id, 'ID-64');
  assert.equal(result.results[0].lowest.equipment_id, 'ID-1');
  assert.equal(result.results[0].lowest.value, 0);
});

test('uses one aggregate query for fleet diagnostics', async () => {
  const fleet = Array.from({ length: 7 }, (_, i) => ({ ...machine, equipment_id: `ID-${i}` }));
  const postgres = {
    async listEquipment() {
      return fleet;
    },
    async getDiagnosticRows() {
      assert.fail('Fleet diagnostics should not run one query per machine');
    },
    async getFleetDiagnosticRows(type, _range, ids) {
      assert.equal(type, 'state');
      assert.deepEqual(
        ids,
        fleet.map((item) => item.equipment_id)
      );
      return [];
    },
  } as Postgres;
  const run = createToolRunner(
    postgres,
    {
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-02T00:00:00Z'),
    },
    AbortSignal.timeout(3000)
  );
  const result = await run({
    id: '1',
    type: 'function',
    function: { name: 'get_diagnostics', arguments: '{"kind":"state"}' },
  });
  assert.equal((result as { evaluated: number }).evaluated, 7);
});

test('follows through when a model asks the user to wait before running an OEE diagnosis', async () => {
  const range = { from: new Date('2026-11-24T00:00:00Z'), to: new Date('2026-11-25T00:00:00Z') };
  const lookup: ToolCall = {
    id: 'lookup',
    type: 'function',
    function: { name: 'find_equipment', arguments: '{"query":"Machine A"}' },
  };
  const diagnose: ToolCall = {
    id: 'diagnose',
    type: 'function',
    function: { name: 'get_diagnostics', arguments: '{"kind":"oee","equipment_ids":["A-001"]}' },
  };
  const responses = [
    { text: '', toolCalls: [lookup] },
    { text: 'I am running diagnostics now. Please wait a moment.', toolCalls: [] },
    { text: '', toolCalls: [diagnose] },
    { text: 'Quality was 0%, which explains the low OEE.', toolCalls: [] },
  ];
  const evidenceKinds: string[] = [];
  const grafana: Grafana = {
    async stream(messages, _signal, emit) {
      const response = responses.shift()!;
      if (response.toolCalls[0] === diagnose) {
        assert.match(messages.at(-1)!.content!, /remaining tool calls/);
      }
      if (!responses.length) {
        assert.match(messages.at(-1)!.content!, /"quality":0/);
      }
      if (response.text) {
        await emit(response.text);
      }
      return response;
    },
    close: () => undefined,
  };
  const postgres = {
    async listEquipment() {
      return [machine];
    },
    async getMetricRows(metric, _range, ids) {
      assert.equal(metric, 'oee');
      assert.deepEqual(ids, ['A-001']);
      return [{ equipment_id: 'A-001', oee: 0, availability: 95, performance: 90, quality: 0 }];
    },
    async getDiagnosticRows(evidence) {
      evidenceKinds.push(evidence);
      return { rows: [], truncated: false };
    },
  } as Postgres;
  let answer = '';
  await createChat(grafana, postgres)(
    {
      message: 'Why is Machine A OEE so low?',
      history: [],
      range,
    },
    AbortSignal.timeout(3000),
    async (delta) => {
      answer += delta;
    }
  );
  assert.deepEqual(evidenceKinds, ['oeeState', 'output']);
  assert.ok(answer.endsWith('Quality was 0%, which explains the low OEE.'));
  assert.equal(responses.length, 0);
});

test('uses one utilization result for the fleet ranking headline and table', async () => {
  const range = { from: new Date('2026-11-17T00:00:00Z'), to: new Date('2026-11-24T00:00:00Z') };
  const fleet = [machine, { ...machine, equipment_id: 'B-001' }, { ...machine, equipment_id: 'C-001' }];
  const postgres = {
    async listEquipment() {
      return fleet;
    },
    async getMetricRows(metric, dates, ids) {
      assert.equal(metric, 'utilization');
      assert.deepEqual(dates, range);
      assert.deepEqual(ids, ['A-001', 'B-001', 'C-001']);
      return [
        { equipment_id: 'A-001', equipment: 'Machine A', site: 'SG', utilization: 8.06 },
        { equipment_id: 'B-001', equipment: 'Machine B', site: 'SG', utilization: 10 },
        { equipment_id: 'C-001', equipment: 'Machine C', site: 'SG', utilization: null },
      ];
    },
  } as Postgres;
  const grafana: Grafana = {
    async stream() {
      assert.fail('A direct fleet rank should use the query result for its answer');
    },
    close: () => undefined,
  };
  let text = '';
  const actions: ToolActivity[] = [];
  await createChat(grafana, postgres)(
    { message: 'Which equipment has the lowest utilization rate?', history: [], range },
    AbortSignal.timeout(3000),
    async (delta) => {
      text += delta;
    },
    async (activity) => {
      actions.push(activity);
    }
  );

  assert.match(text, /Machine A \(A-001\).*8\.06%/);
  assert.doesNotMatch(text, /tied/);
  assert.deepEqual(actions.at(-1)?.report?.table?.rows[0], ['SG', 'Machine A (A-001)', 8.06]);
});
