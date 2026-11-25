import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Equipment } from './postgres.ts';
import { ChatError } from './types.ts';
import type { MetricName, TimeRange } from './types.ts';

const sources = [
  {
    name: 'UCAP-AOI01',
    env: 'UCAP_AOI01_DATABASE_URL',
    file: 'ucap-aoi01.sql',
    equipment_id: 'SINAOI01',
    site: 'UCAP',
    equipment: 'POWER BOX AOI',
    check: 'SELECT 1 FROM inspection CROSS JOIN inspection_detail LIMIT 0',
  },
  {
    name: 'UCAP-AOI02',
    env: 'UCAP_AOI02_DATABASE_URL',
    file: 'ucap-aoi02.sql',
    equipment_id: 'SINAOI02',
    site: 'UCAP',
    equipment: 'GAS PANEL AOI',
    check: 'SELECT 1 FROM aoi02_inspection CROSS JOIN aoi02_inspection_detail LIMIT 0',
  },
  {
    name: 'UCME-WLD01',
    env: 'UCME_WLD01_DATABASE_URL',
    file: 'ucme-wld01.sql',
    equipment_id: 'UCME-WLD-01',
    site: 'UCME',
    equipment: 'WELDMENT INSPECTION',
    check: 'SELECT 1 FROM inspection LIMIT 0',
  },
];

const oeeFields = ['oee', 'availability', 'performance', 'quality'] as const;

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function openInspectionSources() {
  return new Map(
    sources.flatMap((source) => {
      const connectionString = process.env[source.env]?.trim();
      if (!connectionString) {
        return [];
      }
      const sql = readFileSync(new URL(`./sql/${source.file}`, import.meta.url), 'utf8');
      const pool = new pg.Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 15_000,
        options: '-c default_transaction_read_only=on -c timezone=Asia/Singapore',
      });
      pool.on('error', (error) => console.error(`PostgreSQL idle connection failed for ${source.name}:`, error.name));

      const equipment: Equipment = {
        equipment_id: source.equipment_id,
        site: source.site,
        equipment: source.equipment,
        eqp_type: 'Inspection',
        eqp_serial_no: null,
        plan_prod_time_min: 480,
        ideal_cycle_time_min: null,
        oee_threshold: null,
        utilization_threshold: null,
        aliases: [source.name],
      };
      const identity = {
        equipment_id: source.equipment_id,
        equipment: source.equipment,
        site: source.site,
        equipment_type: equipment.eqp_type,
        inspection_source: source.name,
      };
      const makeRow = (metric: MetricName, status?: 'source_unavailable' | 'metric_unavailable') => ({
        ...identity,
        [metric]: null,
        ...(metric === 'oee' ? { availability: null, performance: null, quality: null } : {}),
        ...(status && { source_status: status }),
      });

      return [
        [
          source.equipment_id,
          {
            equipment,
            async check() {
              try {
                await pool.query(source.check);
              } catch {
                throw new ChatError(`PostgreSQL inspection source ${source.name} is unavailable.`);
              }
            },
            async getMetricRow(metric: MetricName, range: TimeRange): Promise<Record<string, unknown>> {
              if (metric !== 'oee' && metric !== 'utilization') {
                return makeRow(metric, 'metric_unavailable');
              }
              try {
                const [row] = (await pool.query(sql, [range.from, range.to])).rows;
                if (!row) {
                  return makeRow(metric);
                }
                return metric === 'oee'
                  ? {
                      ...identity,
                      ...Object.fromEntries(oeeFields.map((field) => [field, readNumber(row[field])])),
                    }
                  : { ...identity, utilization: readNumber(row.utilization) };
              } catch (error) {
                console.error(
                  `PostgreSQL inspection query failed for ${source.name}:`,
                  (error as pg.DatabaseError).code ?? 'connection error'
                );
                return makeRow(metric, 'source_unavailable');
              }
            },
            close: () => pool.end(),
          },
        ] as const,
      ];
    })
  );
}
