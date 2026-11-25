export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ModelMessage =
  | { role: ChatMessage['role'] | 'system'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  range: TimeRange;
  context?: QueryContext;
}

export type MetricName =
  | 'oee'
  | 'fpy'
  | 'utilization'
  | 'work_orders'
  | 'idle_hours'
  | 'run_hours'
  | 'down_hours'
  | 'wait_hours'
  | 'input_parts'
  | 'good_parts'
  | 'rejected_parts';

export type DiagnosticToolName =
  | 'diagnose_oee'
  | 'diagnose_availability'
  | 'diagnose_performance'
  | 'diagnose_quality'
  | 'diagnose_fpy'
  | 'diagnose_utilization';

export type EmitDelta = (text: string) => Promise<void>;

export interface QueryContext {
  equipmentIds?: string[];
  site?: string;
  metrics: MetricName[];
  range: { from: string; to: string };
  baseline?: { from: string; to: string };
}

export interface MetricTable {
  caption: string;
  columns: Array<{ label: string; unit?: '%' | 'h' | 'pp' }>;
  rows: Array<Array<string | number | null>>;
  total: number;
}

export interface ToolReport {
  evidence: string[];
  context?: QueryContext;
  table?: MetricTable;
}

export interface ToolActivity {
  id: number;
  label: string;
  status: 'running' | 'completed' | 'failed';
  report?: ToolReport;
}

export class ChatError extends Error {}
