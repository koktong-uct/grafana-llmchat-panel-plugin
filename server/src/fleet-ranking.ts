import type { MetricName, ToolCall } from './types.ts';

const fields: Record<string, [MetricName, string, string?]> = {
  utilization: ['utilization', 'utilization', '%'],
  'utilization rate': ['utilization', 'utilization', '%'],
  oee: ['oee', 'oee', '%'],
  fpy: ['fpy', 'fpy', '%'],
  'first pass yield': ['fpy', 'fpy', '%'],
  availability: ['oee', 'availability', '%'],
  performance: ['oee', 'performance', '%'],
  quality: ['oee', 'quality', '%'],
  'work orders': ['work_orders', 'work_orders'],
  'idle hours': ['idle_hours', 'idle_hours', ' h'],
  'idle time': ['idle_hours', 'idle_hours', ' h'],
  'run hours': ['run_hours', 'run_hours', ' h'],
  'down hours': ['down_hours', 'down_hours', ' h'],
  'wait hours': ['wait_hours', 'wait_hours', ' h'],
  'input parts': ['input_parts', 'input_parts'],
  'good parts': ['good_parts', 'good_parts'],
  'rejected parts': ['rejected_parts', 'rejected_parts'],
};

export function fleetRanking(question: string) {
  const clean = question
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/, '');
  const match =
    /^(?:(?:which (?:equipment|machine)|who|what(?: equipment)?) (?:has|had|is) |show me )?(?:the )?(highest|lowest) (.+)$/.exec(
      clean
    );
  if (!match) {
    return undefined;
  }
  const phrase = match[2].replace(
    /(?: currently| (?:for|in|during|over) (?:the )?(?:selected (?:time )?range|dashboard (?:range|period)))$/,
    ''
  );
  const field = Object.hasOwn(fields, phrase) ? fields[phrase] : undefined;
  if (!field) {
    return undefined;
  }
  const which = match[1] as 'highest' | 'lowest';
  const [metric, rankBy, unit] = field;
  const call: ToolCall = {
    id: 'fleet-ranking',
    type: 'function',
    function: {
      name: 'get_metrics',
      arguments: JSON.stringify({ metrics: [metric], rank_by: rankBy, order: which === 'lowest' ? 'asc' : 'desc' }),
    },
  };
  const label = metric === rankBy && (metric === 'oee' || metric === 'fpy') ? metric.toUpperCase() : phrase;
  return { call, which, label, unit };
}

interface Extreme {
  equipment: string;
  equipment_id: string;
  site: string;
  value: number;
  tied_equipment: number;
}

const numbers = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 2 });

export function explainFleetRanking(ranking: NonNullable<ReturnType<typeof fleetRanking>>, result: unknown): string {
  const query = result as {
    results?: Array<Partial<Record<'highest' | 'lowest', Extreme>> & { unavailable_sources?: number }>;
    error?: string;
  };
  if (query.error) {
    return query.error;
  }
  const measurement = query.results?.[0];
  const extreme = measurement?.[ranking.which];
  const unavailable = measurement?.unavailable_sources ?? 0;
  const coverage = unavailable
    ? ` ${unavailable} inspection source ${unavailable === 1 ? 'query was' : 'queries were'} unavailable.`
    : '';
  if (!extreme) {
    return `No equipment had a measured ${ranking.label} in the selected dashboard period.${coverage}`;
  }
  const machine = `${extreme.equipment} (${extreme.equipment_id})`;
  const value = `${numbers.format(extreme.value)}${ranking.unit ?? ''}`;
  if (extreme.tied_equipment > 1) {
    return `${extreme.tied_equipment} machines tied for the ${ranking.which} ${ranking.label} at **${value}** in the selected period, including ${machine}.${coverage}`;
  }
  return `**${machine}** had the ${ranking.which} measured ${ranking.label} at **${value}** in the selected dashboard period.${coverage}`;
}
