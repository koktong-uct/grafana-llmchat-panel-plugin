import type { DiagnosticToolName, MetricName } from './types.ts';
import type { EvidenceName } from './postgres.ts';

interface DiagnosticTool {
  description: string;
  metric: MetricName;
  evidence: EvidenceName[];
}

export const diagnosticTools: Record<DiagnosticToolName, DiagnosticTool> = {
  diagnose_oee: {
    description:
      'Explain low or unavailable OEE. Returns availability, performance, quality, daily state minutes and production counts in one call.',
    metric: 'oee',
    evidence: ['oeeState', 'output'],
  },
  diagnose_availability: {
    description: 'Investigate availability using daily recorded RUN, DOWN, WAIT and IDLE minutes.',
    metric: 'oee',
    evidence: ['state'],
  },
  diagnose_performance: {
    description: 'Investigate performance using daily runtime, input quantities and production output.',
    metric: 'oee',
    evidence: ['state', 'output'],
  },
  diagnose_quality: {
    description: 'Investigate OEE quality using daily input, good output, and rejected output quantities.',
    metric: 'oee',
    evidence: ['output'],
  },
  diagnose_fpy: {
    description: 'Investigate first pass yield using only production output records included in the FPY calculation.',
    metric: 'fpy',
    evidence: ['firstPassOutput'],
  },
  diagnose_utilization: {
    description: 'Investigate utilization using daily equipment state minutes that overlap the selected range.',
    metric: 'utilization',
    evidence: ['utilizationState'],
  },
};
