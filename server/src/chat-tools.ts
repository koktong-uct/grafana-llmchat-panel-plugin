import { diagnosticTools } from './diagnostics.ts';
import { findEquipment } from './equipment.ts';
import { metricSql } from './metric-sql.ts';
import type { Equipment, EvidenceName, Postgres } from './postgres.ts';
import { describeMetricQuery, describeQuery } from './query-report.ts';
import type { MetricResult } from './query-report.ts';
import { formatSingaporeRange, parseRange } from './time-range.ts';
import { ChatError } from './types.ts';
import type { DiagnosticToolName, MetricName, ModelTool, TimeRange, ToolCall, ToolReport } from './types.ts';

const equipmentIds = { type: 'array', items: { type: 'string' }, description: 'Verified equipment IDs.' };
const siteFilter = { type: 'string', description: 'Optional site name or code.' };
const timeBounds = {
  from: {
    type: 'string',
    description: 'Inclusive ISO timestamp with timezone. Omit both bounds for the dashboard range.',
  },
  to: { type: 'string', description: 'Exclusive ISO timestamp with timezone.' },
};
const diagnosticKinds = ['state', 'production', ...Object.keys(diagnosticTools).map((name) => name.slice(9))];
const oeeComponents = ['availability', 'performance', 'quality'];
const metricFields = [...Object.keys(metricSql), ...oeeComponents];
const configurationFields = ['plan_prod_time_min', 'ideal_cycle_time_min', 'oee_threshold', 'utilization_threshold'];
const sortOrder = { type: 'string', enum: ['asc', 'desc'] };
const displayLimit = 60;

function definition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): ModelTool {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  };
}

export const chatTools = [
  definition(
    'find_equipment',
    'Look up equipment configuration and identity from dim_equipment. Returns site, type, serial number, planned production time in minutes, ideal cycle time in minutes, and configured OEE and utilization thresholds. Also lists sites or equipment and resolves names to IDs.',
    {
      query: { type: 'string', description: 'Optional equipment name, ID or serial number. Omit to list equipment.' },
      site: siteFilter,
      equipment_type: { type: 'string', description: 'Optional equipment type such as Tool or Equipment.' },
      rank_by: {
        type: 'string',
        enum: configurationFields,
        description: 'Rank equipment by a numeric configuration field.',
      },
      order: sortOrder,
    }
  ),
  definition(
    'get_metrics',
    'Compare or rank the entire fleet by KPI, state hours, or production quantities. With no equipment IDs or site, evaluates all equipment. Use idle_hours for highest idle time. OEE includes availability, performance and quality. Optional comparison bounds provide a baseline period and per-equipment changes.',
    {
      metrics: { type: 'array', items: { type: 'string', enum: Object.keys(metricSql) } },
      equipment_ids: equipmentIds,
      site: siteFilter,
      rank_by: { type: 'string', enum: metricFields, description: 'Field to rank. Request oee for its components.' },
      order: sortOrder,
      comparison_from: { type: 'string', description: 'Optional baseline start as an ISO timestamp with timezone.' },
      comparison_to: { type: 'string', description: 'Optional baseline end as an ISO timestamp with timezone.' },
      rank_by_change: { type: 'boolean', description: 'Sort by current minus baseline. Requires baseline bounds.' },
      ...timeBounds,
    },
    ['metrics']
  ),
  definition(
    'get_diagnostics',
    'Investigate a KPI using evidence. Accepts all equipment by default and returns period summaries for broad scopes or daily evidence for small scopes. Use get_metrics for highest or lowest totals across equipment.',
    {
      kind: {
        type: 'string',
        enum: diagnosticKinds,
        description: [
          'Use state for RUN, DOWN, WAIT and IDLE minutes. Use production for input, good output and rejects.',
          ...Object.entries(diagnosticTools).map(([name, tool]) => `${name.slice(9)}: ${tool.description}`),
        ].join(' '),
      },
      equipment_ids: equipmentIds,
      site: siteFilter,
      ...timeBounds,
    },
    ['kind']
  ),
];

function readArguments(input: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(input || '{}');
  } catch {
    throw new ChatError('The tool arguments must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChatError('The tool arguments must be an object.');
  }
  return value as Record<string, unknown>;
}

export function describeToolCall({ function: { name, arguments: input } }: ToolCall): string {
  if (name === 'find_equipment') {
    return 'Look up equipment';
  }
  let args: Record<string, unknown>;
  try {
    args = readArguments(input);
  } catch {
    args = {};
  }
  if (name === 'get_metrics') {
    const metrics = Array.isArray(args.metrics)
      ? metricFields.filter((metric) => (args.metrics as unknown[]).includes(metric))
      : [];
    const label = args.comparison_from && args.comparison_to ? 'Compare metrics' : 'Query metrics';
    const names = metrics.map((metric) =>
      metric === 'oee' || metric === 'fpy' ? metric.toUpperCase() : metric.replaceAll('_', ' ')
    );
    return names.length ? `${label} · ${names.join(', ')}` : label;
  }
  if (name === 'get_diagnostics') {
    return typeof args.kind === 'string' && diagnosticKinds.includes(args.kind)
      ? `Query diagnostic evidence · ${args.kind === 'fpy' || args.kind === 'oee' ? args.kind.toUpperCase() : args.kind}`
      : 'Query diagnostic evidence';
  }
  return 'Run requested tool';
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 200) {
    throw new ChatError(`${name} must be a string up to 200 characters.`);
  }
  return value.trim() || undefined;
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new ChatError(`${name} must be a nonempty list of strings.`);
  }
  return [...new Set<string>(value)];
}

function orderDirection(value: unknown): number {
  if (value == null || value === 'desc') {
    return -1;
  }
  if (value === 'asc') {
    return 1;
  }
  throw new ChatError('Order must be asc or desc.');
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function rank<T>(rows: T[], score: (row: T) => number | undefined, direction: number): T[] {
  return rows.slice().sort((left, right) => {
    const a = score(left);
    const b = score(right);
    if (a === undefined) {
      return b === undefined ? 0 : 1;
    }
    return b === undefined ? -1 : (a - b) * direction;
  });
}

export function createToolRunner(postgres: Postgres, defaultRange: TimeRange, signal: AbortSignal) {
  let catalog: Equipment[] | undefined;

  return async (
    { function: { name, arguments: input } }: ToolCall,
    onReport?: (report: ToolReport) => void
  ): Promise<unknown> => {
    const args = readArguments(input);
    const tool = chatTools.find((item) => item.function.name === name);
    if (!tool) {
      throw new ChatError('That tool is unavailable. Choose an available tool.');
    }
    const properties = tool.function.parameters.properties as Record<string, unknown>;
    if (Object.keys(args).some((key) => !Object.hasOwn(properties, key))) {
      throw new ChatError('The tool arguments contain an unsupported field. Use the fields in the tool definition.');
    }
    signal.throwIfAborted();
    const equipment = (catalog ??= await postgres.listEquipment());
    const site = optionalText(args.site, 'site');
    if (name === 'find_equipment') {
      const matches = findEquipment(
        equipment,
        optionalText(args.query, 'query'),
        site,
        optionalText(args.equipment_type, 'equipment_type')
      );
      const field = optionalText(args.rank_by, 'rank_by');
      if (field && !configurationFields.includes(field)) {
        throw new ChatError('Choose a numeric equipment configuration field.');
      }
      const ordered = field
        ? rank(matches, (item) => numeric(item[field as keyof Equipment]), orderDirection(args.order))
        : matches;
      onReport?.({
        evidence: [`${matches.length} equipment matched the lookup`, ...(site ? [`Site filter · ${site}`] : [])],
      });
      return {
        sites: [...new Set(matches.map((item) => item.site))],
        equipment: ordered.slice(0, displayLimit),
        matched: matches.length,
        truncated: matches.length > displayLimit,
      };
    }

    const range = args.from == null && args.to == null ? defaultRange : parseRange(args.from, args.to);
    let matches = findEquipment(equipment, undefined, site);
    if (args.equipment_ids != null) {
      const ids = strings(args.equipment_ids, 'equipment_ids');
      matches = matches.filter((item) => ids.includes(item.equipment_id));
      const unknown = ids.filter((id) => !matches.some((item) => item.equipment_id === id));
      if (unknown.length) {
        return {
          error: 'Some equipment IDs were not found in this scope. Look up the correct IDs.',
          unknown: unknown.slice(0, 10),
        };
      }
    }
    if (!matches.length) {
      return { range, error: 'No equipment matched. Try looking up the site or equipment name.' };
    }
    const targeted = args.equipment_ids != null;

    if (name === 'get_metrics') {
      const metrics = strings(args.metrics, 'metrics');
      if (metrics.some((metric) => !Object.hasOwn(metricSql, metric))) {
        throw new ChatError('Choose supported fields from the metric tool definition.');
      }
      const field = optionalText(args.rank_by, 'rank_by');
      if (field && !metrics.includes(field) && !(metrics.includes('oee') && oeeComponents.includes(field))) {
        throw new ChatError('Include the metric that contains the requested ranking field.');
      }
      const baseline =
        args.comparison_from == null && args.comparison_to == null
          ? undefined
          : parseRange(args.comparison_from, args.comparison_to);
      if (args.rank_by_change != null && typeof args.rank_by_change !== 'boolean') {
        throw new ChatError('rank_by_change must be a boolean.');
      }
      if (args.rank_by_change && !baseline) {
        throw new ChatError('Supply a baseline period to rank by change.');
      }
      const direction = orderDirection(args.order);
      const ids = matches.map((item) => item.equipment_id);
      const results = [];
      const reportResults: MetricResult[] = [];
      for (const metric of metrics as MetricName[]) {
        signal.throwIfAborted();
        const fields = metric === 'oee' ? [metric, ...oeeComponents] : [metric];
        const rankField = field && fields.includes(field) ? field : metric;
        const current = await postgres.getMetricRows(metric, range, ids);
        signal.throwIfAborted();
        const priorRows = baseline ? await postgres.getMetricRows(metric, baseline, ids) : [];
        const prior = new Map(priorRows.map((row) => [row.equipment_id, row]));
        const rows = current.map((row) => {
          if (!baseline) {
            return { row, score: numeric(row[rankField]) };
          }
          const previous = Object.fromEntries(
            fields.map((key) => [key, numeric(prior.get(row.equipment_id)?.[key]) ?? null])
          );
          const change = Object.fromEntries(
            fields.map((key) => {
              const value = numeric(row[key]);
              const before = previous[key];
              return [key, value === undefined || before === null ? null : value - before];
            })
          );
          return {
            row: { ...row, previous, change },
            score: args.rank_by_change ? numeric(change[rankField]) : numeric(row[rankField]),
          };
        });
        const ranked = rank(rows, (entry) => entry.score, direction);
        const measured = ranked.filter((entry) => entry.score !== undefined);
        const first = measured.at(0);
        const last = measured.at(-1);
        const extreme = (entry: typeof first) => {
          if (!entry) {
            return undefined;
          }
          const tied = measured.filter((item) => item.score === entry.score);
          const { equipment_id, equipment, site } = tied[0].row;
          return { equipment_id, equipment, site, value: entry.score, tied_equipment: tied.length };
        };
        const result = {
          metric,
          rank_by: rankField,
          ranked_by_change: args.rank_by_change === true,
          lowest: extreme(direction === 1 ? first : last),
          highest: extreme(direction === 1 ? last : first),
          measured: measured.length,
          unavailable_sources: current.filter((row) => row.source_status === 'source_unavailable').length,
          rows: ranked.map((entry) => entry.row),
          evaluated: rows.length,
          truncated: rows.length > displayLimit,
        };
        if (onReport) {
          reportResults.push(result);
        }
        results.push({ ...result, rows: result.rows.slice(0, displayLimit) });
      }
      if (onReport) {
        onReport(describeMetricQuery(reportResults, matches, range, site, targeted, baseline));
      }
      return {
        range,
        range_singapore: formatSingaporeRange(range),
        baseline,
        baseline_singapore: baseline && formatSingaporeRange(baseline),
        results,
        matched: matches.length,
        truncated: results.some((result) => result.truncated),
      };
    }

    const kind = optionalText(args.kind, 'kind');
    if (!kind || !diagnosticKinds.includes(kind)) {
      throw new ChatError('Choose an available diagnostic kind.');
    }
    const diagnostic = diagnosticTools[`diagnose_${kind}` as DiagnosticToolName];
    const evidence: EvidenceName[] = diagnostic?.evidence ?? [kind === 'state' ? 'state' : 'output'];
    const ids = matches.map((item) => item.equipment_id);
    const kpis = diagnostic ? await postgres.getMetricRows(diagnostic.metric, range, ids) : undefined;
    if (matches.length > 5) {
      const displayed = new Set(ids.slice(0, displayLimit));
      const summaries = [];
      for (const type of evidence) {
        signal.throwIfAborted();
        const summary = await postgres.getFleetDiagnosticRows(type, range, ids);
        summaries.push({ type, rows: summary.filter((item) => displayed.has(String(item.equipment_id))) });
      }
      if (onReport) {
        const report = describeQuery(matches, range, diagnostic ? [diagnostic.metric] : [], site, targeted);
        report.evidence.push(
          `Period totals · ${evidence.length} evidence ${evidence.length === 1 ? 'source' : 'sources'}`
        );
        onReport(report);
      }
      return {
        range,
        kind,
        granularity: 'period_total',
        evaluated: ids.length,
        truncated: ids.length > displayLimit,
        kpis: kpis?.filter((item) => displayed.has(String(item.equipment_id))),
        equipment: matches
          .slice(0, displayLimit)
          .map(({ equipment_id, equipment, site }) => ({ equipment_id, equipment, site })),
        evidence: summaries,
      };
    }
    const rows = [];
    for (const { equipment_id, equipment, site } of matches) {
      for (const type of evidence) {
        signal.throwIfAborted();
        const result = await postgres.getDiagnosticRows(type, range, equipment_id);
        rows.push({
          equipment_id,
          equipment,
          site,
          type,
          rows: result.rows.slice(0, 60),
          truncated: result.truncated || result.rows.length > 60,
        });
      }
    }
    const configuration =
      kind === 'oee'
        ? matches.map(({ equipment_id, plan_prod_time_min, ideal_cycle_time_min }) => ({
            equipment_id,
            plan_prod_time_min,
            ideal_cycle_time_min,
          }))
        : undefined;
    if (onReport) {
      const report = describeQuery(matches, range, diagnostic ? [diagnostic.metric] : [], site, targeted);
      const shown = rows.reduce((total, result) => total + result.rows.length, 0);
      report.evidence.push(`${shown} daily evidence ${shown === 1 ? 'row' : 'rows'} returned`);
      onReport(report);
    }
    return { range, kind, kpis, configuration, evidence: rows };
  };
}
