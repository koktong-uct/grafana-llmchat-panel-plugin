import { readFileSync } from 'node:fs';
import pg from 'pg';
import { openInspectionSources } from './inspection-sources.ts';
import { evidenceSql, fleetEvidenceSql, metricSql } from './metric-sql.ts';
import { ChatError } from './types.ts';
import type { MetricName, TimeRange } from './types.ts';

export type Equipment = {
  equipment_id: string;
  site: string;
  equipment: string;
  eqp_type: string | null;
  eqp_serial_no: string | null;
  plan_prod_time_min: number | null;
  ideal_cycle_time_min: number | null;
  oee_threshold: number | null;
  utilization_threshold: number | null;
  aliases?: string[];
};
export type EvidenceName = keyof typeof evidenceSql;

export function createPostgres() {
  const inspections = openInspectionSources();
  const host = process.env.PGHOST?.trim();
  const caFile = process.env.PGSSLROOTCERT;
  const ssl = caFile ? { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } : undefined;
  const pool = host
    ? new pg.Pool({
        host,
        ssl,
        max: 4,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 15_000,
        options: '-c default_transaction_read_only=on -c timezone=Asia/Singapore',
      })
    : undefined;
  pool?.on('error', (error) => console.error('PostgreSQL idle connection failed:', error.name));

  async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    if (!pool) {
      throw new ChatError('Set PGHOST and the PostgreSQL credentials in the backend environment.');
    }
    try {
      return (await pool.query<T>(text, values)).rows;
    } catch (error) {
      console.error('PostgreSQL query failed:', (error as pg.DatabaseError).code ?? 'connection error');
      throw new ChatError('PostgreSQL query failed. Check the backend connection settings and logs.');
    }
  }

  return {
    async check() {
      await query(`
        SELECT 1
        FROM public.dim_equipment
        CROSS JOIN public.fact_equipment_state
        CROSS JOIN public.fact_production_output
        LIMIT 0
      `);
      await Promise.all([...inspections.values()].map((source) => source.check()));
    },
    async listEquipment() {
      const equipment = await query<Equipment>(`
        SELECT eqp_id AS equipment_id, eqp_site AS site, eqp_name AS equipment,
               eqp_type, eqp_serial_no, plan_prod_time_min, ideal_cycle_time_min,
               oee_threshold, utilization_threshold
        FROM public.dim_equipment
        WHERE eqp_site IS NOT NULL AND eqp_name IS NOT NULL
        ORDER BY site, equipment, equipment_id
      `);
      const catalog = new Map(equipment.map((item) => [item.equipment_id, item]));
      for (const { equipment: external } of inspections.values()) {
        const existing = catalog.get(external.equipment_id);
        catalog.set(external.equipment_id, {
          ...external,
          eqp_serial_no: existing?.eqp_serial_no ?? null,
          oee_threshold: existing?.oee_threshold ?? null,
          utilization_threshold: existing?.utilization_threshold ?? null,
        });
      }
      return [...catalog.values()];
    },
    async getMetricRows(metric: MetricName, range: TimeRange, equipmentIds: string[]) {
      const coreIds = equipmentIds.filter((id) => !inspections.has(id));
      const inspectionRows = equipmentIds.flatMap((id) => {
        const source = inspections.get(id);
        return source ? [source.getMetricRow(metric, range)] : [];
      });
      const [coreRows, ...externalRows] = await Promise.all([
        coreIds.length
          ? query<Record<string, unknown>>(metricSql[metric], [range.from, range.to, coreIds])
          : Promise.resolve([]),
        ...inspectionRows,
      ]);
      return [...coreRows, ...externalRows];
    },
    async getDiagnosticRows(evidence: EvidenceName, range: TimeRange, equipmentId: string) {
      if (inspections.has(equipmentId)) {
        return { rows: [], truncated: false };
      }
      const rows = await query<Record<string, unknown>>(`SELECT * FROM (${evidenceSql[evidence]}) evidence LIMIT 201`, [
        range.from,
        range.to,
        equipmentId,
      ]);
      return { rows: rows.slice(0, 200), truncated: rows.length > 200 };
    },
    async getFleetDiagnosticRows(evidence: EvidenceName, range: TimeRange, equipmentIds: string[]) {
      const coreIds = equipmentIds.filter((id) => !inspections.has(id));
      return coreIds.length
        ? query<Record<string, unknown>>(fleetEvidenceSql[evidence], [range.from, range.to, coreIds])
        : [];
    },
    close: () => Promise.all([pool?.end(), ...[...inspections.values()].map((source) => source.close())]),
  };
}

export type Postgres = ReturnType<typeof createPostgres>;
