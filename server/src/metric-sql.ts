import type { MetricName } from './types.ts';

const selectedEquipment = `
  SELECT eqp_id, eqp_name, eqp_site, eqp_type, plan_prod_time_min,
         ideal_cycle_time_min, oee_threshold, utilization_threshold
  FROM public.dim_equipment
  WHERE eqp_id = ANY($3::text[])
`;

const oee = `
  WITH equipment AS (${selectedEquipment}),
  states AS (
    SELECT s.eqp_id,
           COUNT(DISTINCT (s.created_at AT TIME ZONE 'Asia/Singapore')::date) AS recorded_days,
           COUNT(DISTINCT s.work_order_id) AS work_orders,
           SUM(s.duration_mins) FILTER (WHERE s.state = 'RUN') AS run_minutes,
           SUM(s.duration_mins) FILTER (WHERE s.state = 'DOWN') AS down_minutes,
           SUM(s.duration_mins) FILTER (WHERE s.state = 'WAIT') AS wait_minutes
    FROM public.fact_equipment_state s
    JOIN equipment e USING (eqp_id)
    WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
    GROUP BY s.eqp_id
  ),
  output AS (
    SELECT o.eqp_id, SUM(o.total_input_qty) AS total_input, SUM(o.output_ok) AS output_ok
    FROM public.fact_production_output o
    JOIN equipment e USING (eqp_id)
    WHERE o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
    GROUP BY o.eqp_id
  ),
  components AS (
    SELECT e.eqp_id, e.eqp_name, e.eqp_site, e.eqp_type, e.oee_threshold,
           CASE WHEN s.work_orders > 0 AND s.recorded_days * e.plan_prod_time_min > 0
                THEN GREATEST(1.0 - (COALESCE(s.down_minutes, 0) + COALESCE(s.wait_minutes, 0))
                     / (s.recorded_days * e.plan_prod_time_min), 0) END AS availability_ratio,
           CASE WHEN s.run_minutes > 0 AND e.ideal_cycle_time_min IS NOT NULL
                THEN LEAST(e.ideal_cycle_time_min * COALESCE(o.total_input, 0) / s.run_minutes, 1.0)
                END AS performance_ratio,
           o.output_ok::double precision / NULLIF(o.total_input, 0) AS quality_ratio
    FROM equipment e
    LEFT JOIN states s USING (eqp_id)
    LEFT JOIN output o USING (eqp_id)
  )
  SELECT eqp_id AS equipment_id, eqp_name AS equipment, eqp_site AS site, eqp_type AS equipment_type,
         availability_ratio * 100 AS availability, performance_ratio * 100 AS performance,
         quality_ratio * 100 AS quality,
         availability_ratio * performance_ratio * quality_ratio * 100 AS oee, oee_threshold
  FROM components
  ORDER BY site, equipment, equipment_id
`;

const singaporeDays = `
  SELECT local_day
  FROM generate_series(
    date_trunc('day', $1::timestamptz AT TIME ZONE 'Asia/Singapore'),
    date_trunc('day', ($2::timestamptz - INTERVAL '1 microsecond') AT TIME ZONE 'Asia/Singapore'),
    INTERVAL '1 day'
  ) AS days(local_day)
`;

const utilization = `
  WITH equipment AS (${selectedEquipment}),
  weekdays AS (
    SELECT COUNT(*)::integer AS production_days
    FROM generate_series(
      0,
      CEIL(EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 86400.0)::integer - 1
    ) AS days(day_offset)
    WHERE EXTRACT(ISODOW FROM (
      ($1::timestamptz AT TIME ZONE 'Asia/Singapore') + days.day_offset * INTERVAL '1 day'
    )) BETWEEN 1 AND 5
  ),
  runtime AS (
    SELECT s.eqp_id,
           COUNT(DISTINCT s.work_order_id) AS work_order_count,
           COALESCE(
             SUM(EXTRACT(EPOCH FROM (LEAST(s.end_datetime, $2::timestamptz)
               - GREATEST(s.start_datetime, $1::timestamptz))) / 60.0) FILTER (WHERE s.state = 'RUN'),
             0
           ) AS run_minutes
    FROM public.fact_equipment_state s
    JOIN equipment e USING (eqp_id)
    WHERE s.start_datetime < $2::timestamptz AND s.end_datetime > $1::timestamptz
    GROUP BY s.eqp_id
  )
  SELECT e.eqp_id AS equipment_id, e.eqp_name AS equipment, e.eqp_site AS site, e.eqp_type AS equipment_type,
         CASE WHEN r.work_order_count > 0
              THEN (r.run_minutes / NULLIF(w.production_days * e.plan_prod_time_min, 0) * 100)::double precision
              END AS utilization,
         e.utilization_threshold, w.production_days, e.plan_prod_time_min, r.run_minutes::double precision AS run_minutes
  FROM equipment e
  CROSS JOIN weekdays w
  LEFT JOIN runtime r USING (eqp_id)
  ORDER BY site, equipment, equipment_id
`;

const production = (projection: string, condition = '') => `
  WITH equipment AS (${selectedEquipment})
  SELECT e.eqp_id AS equipment_id, e.eqp_name AS equipment, e.eqp_site AS site, e.eqp_type AS equipment_type,
         ${projection}
  FROM equipment e
  LEFT JOIN public.fact_production_output o
    ON o.eqp_id = e.eqp_id
    AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
    ${condition}
  GROUP BY e.eqp_id, e.eqp_name, e.eqp_site, e.eqp_type
  ORDER BY site, equipment, equipment_id
`;

const stateOverlap = `
  s.start_datetime < $2::timestamptz AND s.end_datetime > $1::timestamptz
  AND s.end_datetime > s.start_datetime
`;
const overlapSeconds = `
  EXTRACT(EPOCH FROM (LEAST(s.end_datetime, $2::timestamptz)
    - GREATEST(s.start_datetime, $1::timestamptz)))
`;

function stateHours(state: 'IDLE' | 'RUN' | 'DOWN' | 'WAIT', field: MetricName) {
  return `
    WITH equipment AS (${selectedEquipment}),
    hours AS (
      SELECT s.eqp_id,
             (COALESCE(SUM(${overlapSeconds}) FILTER (WHERE s.state = '${state}'), 0) / 3600.0)::double precision AS value
      FROM public.fact_equipment_state s
      JOIN equipment e USING (eqp_id)
      WHERE ${stateOverlap}
      GROUP BY s.eqp_id
    )
    SELECT e.eqp_id AS equipment_id, e.eqp_name AS equipment, e.eqp_site AS site,
           e.eqp_type AS equipment_type, h.value AS ${field}
    FROM equipment e
    LEFT JOIN hours h USING (eqp_id)
    ORDER BY site, equipment, equipment_id
  `;
}

export const metricSql: Record<MetricName, string> = {
  oee,
  fpy: production(
    'SUM(o.output_ok)::double precision / NULLIF(SUM(o.total_input_qty), 0) * 100 AS fpy',
    'AND o.fpy = 0'
  ),
  utilization,
  work_orders: production('COUNT(DISTINCT o.work_order_id)::integer AS work_orders'),
  idle_hours: stateHours('IDLE', 'idle_hours'),
  run_hours: stateHours('RUN', 'run_hours'),
  down_hours: stateHours('DOWN', 'down_hours'),
  wait_hours: stateHours('WAIT', 'wait_hours'),
  input_parts: production('SUM(o.total_input_qty)::double precision AS input_parts'),
  good_parts: production('SUM(o.output_ok)::double precision AS good_parts'),
  rejected_parts: production('SUM(o.output_ng)::double precision AS rejected_parts'),
};

const oeeStateFilter = "AND s.state IN ('RUN', 'DOWN', 'WAIT')";
const stateEvidence = (condition = '') => `
  SELECT (s.created_at AT TIME ZONE 'Asia/Singapore')::date::text AS day,
         s.state, SUM(s.duration_mins) AS minutes, COUNT(*)::integer AS records
  FROM public.fact_equipment_state s
  WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz AND s.eqp_id = $3
    ${condition}
  GROUP BY day, s.state
  ORDER BY day, s.state
`;

const outputEvidence = (condition = '') => `
  SELECT (o.created_at AT TIME ZONE 'Asia/Singapore')::date::text AS day,
         SUM(o.total_input_qty)::double precision AS total_input,
         SUM(o.output_ok)::double precision AS output_ok, SUM(o.output_ng)::double precision AS output_ng,
         COUNT(DISTINCT o.work_order_id)::integer AS work_orders
  FROM public.fact_production_output o
  WHERE o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz AND o.eqp_id = $3
    ${condition}
  GROUP BY day
  ORDER BY day
`;

const utilizationEvidence = `
  WITH days AS (${singaporeDays}),
  windows AS (
    SELECT local_day::date::text AS day,
           GREATEST(local_day AT TIME ZONE 'Asia/Singapore', $1::timestamptz) AS start_time,
           LEAST((local_day + INTERVAL '1 day') AT TIME ZONE 'Asia/Singapore', $2::timestamptz) AS end_time
    FROM days
  )
  SELECT w.day, s.state,
         SUM(EXTRACT(EPOCH FROM (LEAST(s.end_datetime, w.end_time)
          - GREATEST(s.start_datetime, w.start_time))) / 60.0)::double precision AS minutes
  FROM windows w
  JOIN public.fact_equipment_state s
    ON s.start_datetime < w.end_time AND s.end_datetime > w.start_time
  WHERE s.eqp_id = $3 AND s.end_datetime > s.start_datetime
    AND s.start_datetime < $2::timestamptz AND s.end_datetime > $1::timestamptz
  GROUP BY w.day, s.state
  ORDER BY w.day, s.state
`;

export const evidenceSql = {
  state: stateEvidence(),
  oeeState: stateEvidence(oeeStateFilter),
  output: outputEvidence(),
  firstPassOutput: outputEvidence('AND o.fpy = 0'),
  utilizationState: utilizationEvidence,
};

function fleetStateEvidence(timeFilter: string, minutes: string) {
  return `
    SELECT s.eqp_id AS equipment_id, s.state, SUM(${minutes})::double precision AS minutes
    FROM public.fact_equipment_state s
    WHERE s.eqp_id = ANY($3::text[]) AND ${timeFilter}
    GROUP BY s.eqp_id, s.state
    ORDER BY s.eqp_id, s.state
  `;
}

function fleetOutputEvidence(condition = '') {
  return `
    SELECT o.eqp_id AS equipment_id, SUM(o.total_input_qty)::double precision AS total_input,
           SUM(o.output_ok)::double precision AS output_ok, SUM(o.output_ng)::double precision AS output_ng,
           COUNT(DISTINCT o.work_order_id)::integer AS work_orders
    FROM public.fact_production_output o
    WHERE o.eqp_id = ANY($3::text[]) AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
      ${condition}
    GROUP BY o.eqp_id
    ORDER BY o.eqp_id
  `;
}

export const fleetEvidenceSql = {
  state: fleetStateEvidence('s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz', 's.duration_mins'),
  oeeState: fleetStateEvidence(
    `s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz ${oeeStateFilter}`,
    's.duration_mins'
  ),
  output: fleetOutputEvidence(),
  firstPassOutput: fleetOutputEvidence('AND o.fpy = 0'),
  utilizationState: fleetStateEvidence(stateOverlap, `(${overlapSeconds}) / 60.0`),
};
