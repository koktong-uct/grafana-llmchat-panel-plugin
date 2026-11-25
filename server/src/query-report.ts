import { metricSql } from './metric-sql.ts';
import type { Equipment } from './postgres.ts';
import { formatSingaporeRange, parseRange } from './time-range.ts';
import type { MetricName, MetricTable, QueryContext, TimeRange, ToolReport } from './types.ts';

function encodeRange(range: TimeRange) {
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

export function readQueryContext(input: unknown): QueryContext | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const { equipmentIds, site, metrics, range, baseline } = input as QueryContext;
  if (
    !Array.isArray(metrics) ||
    metrics.length > Object.keys(metricSql).length ||
    !metrics.every((metric) => typeof metric === 'string' && Object.hasOwn(metricSql, metric)) ||
    (site !== undefined && (typeof site !== 'string' || site.length > 200)) ||
    (equipmentIds !== undefined &&
      (!Array.isArray(equipmentIds) ||
        equipmentIds.length > 60 ||
        !equipmentIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)))
  ) {
    return undefined;
  }
  try {
    return {
      equipmentIds,
      site,
      metrics,
      range: encodeRange(parseRange(range?.from, range?.to)),
      baseline: baseline && encodeRange(parseRange(baseline.from, baseline.to)),
    };
  } catch {
    return undefined;
  }
}

function scopeEvidence(matches: Equipment[], site?: string, targeted = false): string {
  if (targeted && matches.length <= 3) {
    return matches.map((item) => `${item.equipment} (${item.equipment_id})`).join(', ');
  }
  return `${matches.length} equipment ${site ? `matching site ${site}` : targeted ? 'in scope' : 'across the fleet'}`;
}

function metricLabel(metric: string) {
  if (metric === 'oee' || metric === 'fpy') {
    return metric.toUpperCase();
  }
  const name = metric.replaceAll('_', ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface MetricResult {
  metric: MetricName;
  rank_by: string;
  ranked_by_change: boolean;
  measured: number;
  evaluated: number;
  rows: Record<string, unknown>[];
}

function tableFor(results: MetricResult[], matches: Equipment[], range: TimeRange, baseline?: TimeRange): MetricTable {
  const fields = results.map((result) => {
    const field = result.rank_by;
    const label = metricLabel(field);
    const unit = ['oee', 'fpy', 'utilization', 'availability', 'performance', 'quality'].includes(field)
      ? '%'
      : field.endsWith('_hours')
        ? 'h'
        : undefined;
    return { field, label, unit } as const;
  });
  const columns: MetricTable['columns'] = [{ label: 'Site' }, { label: 'Equipment' }];
  for (const { label, unit } of fields) {
    if (baseline) {
      columns.push({ label: `Previous ${label}`, unit });
    }
    columns.push({ label, unit });
    if (baseline) {
      columns.push({ label: `Change in ${label}`, unit: unit === '%' ? 'pp' : unit });
    }
  }

  const perMetric = results.map((result) => new Map(result.rows.map((row) => [row.equipment_id, row])));
  const value = (item: unknown) => (typeof item === 'number' && Number.isFinite(item) ? item : null);
  const rows = results[0].rows.slice(0, 60).map((equipment) => {
    const name = String(equipment.equipment ?? equipment.equipment_id ?? '');
    const id = equipment.equipment_id;
    const row: MetricTable['rows'][number] = [
      String(equipment.site ?? ''),
      typeof id === 'string' && id !== name ? `${name} (${id})` : name,
    ];
    fields.forEach(({ field }, i) => {
      const record = perMetric[i].get(equipment.equipment_id);
      if (baseline) {
        row.push(value((record?.previous as Record<string, unknown> | undefined)?.[field]));
      }
      row.push(value(record?.[field]));
      if (baseline) {
        row.push(value((record?.change as Record<string, unknown> | undefined)?.[field]));
      }
    });
    return row;
  });
  const period = formatSingaporeRange(range);
  const caption = baseline
    ? `Equipment comparison · ${formatSingaporeRange(baseline)} vs ${period}`
    : `Equipment summary · ${period}`;
  return { caption, columns, rows, total: matches.length };
}

export function describeQuery(
  matches: Equipment[],
  range: TimeRange,
  metrics: MetricName[],
  site?: string,
  targeted = false,
  baseline?: TimeRange
): ToolReport {
  const equipmentIds = targeted ? matches.map((item) => item.equipment_id) : undefined;
  return {
    evidence: [scopeEvidence(matches, site, targeted), formatSingaporeRange(range)],
    context:
      equipmentIds && equipmentIds.length > 60
        ? undefined
        : {
            equipmentIds,
            site,
            metrics,
            range: encodeRange(range),
            baseline: baseline && encodeRange(baseline),
          },
  };
}

export function describeMetricQuery(
  results: MetricResult[],
  matches: Equipment[],
  range: TimeRange,
  site?: string,
  targeted = false,
  baseline?: TimeRange
): ToolReport {
  const report = describeQuery(
    matches,
    range,
    results.map((result) => result.metric),
    site,
    targeted,
    baseline
  );
  if (baseline) {
    report.evidence.push(`Baseline · ${formatSingaporeRange(baseline)}`);
  }
  for (const result of results) {
    const label = metricLabel(result.rank_by);
    const description = result.ranked_by_change ? `${label} change` : label;
    report.evidence.push(`${result.measured} of ${result.evaluated} had ${description} values`);
    const failedSources = result.rows.filter((row) => row.source_status === 'source_unavailable').length;
    if (failedSources) {
      report.evidence.push(
        `${failedSources} inspection source ${failedSources === 1 ? 'query was' : 'queries were'} unavailable for ${description}`
      );
    }
  }
  if (matches.length > 1 && results.length && results[0].rows.length) {
    report.table = tableFor(results, matches, range, baseline);
  }
  return report;
}
