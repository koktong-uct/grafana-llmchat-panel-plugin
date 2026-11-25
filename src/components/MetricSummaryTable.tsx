import React, { useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import type { MetricTable } from '../services/chat';
import { getChatStyles } from './chatStyles';

const previewRows = 8;
const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function displayCell(value: string | number | null, unit?: '%' | 'h' | 'pp') {
  if (typeof value === 'number') {
    return numbers.format(value) + (unit === '%' ? '%' : unit ? ` ${unit}` : '');
  }
  return value ?? '—';
}

export function copyMetricTable(table: MetricTable, includeCaption = true): string {
  const line = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ')).join(' | ')} |`;
  return [
    ...(includeCaption ? [table.caption] : []),
    line(table.columns.map(({ label }) => label)),
    line(table.columns.map(() => '---')),
    ...table.rows.map((row) => line(row.map((value, column) => displayCell(value, table.columns[column]?.unit)))),
  ].join('\n');
}

export function MetricSummaryTable({
  table,
  copied,
  onCopy,
}: {
  table: MetricTable;
  copied: boolean;
  onCopy: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = useStyles2(getChatStyles);
  const rows = expanded ? table.rows : table.rows.slice(0, previewRows);
  return (
    <div className={styles.metricSummary}>
      <div className={cx(styles.markdown, styles.metricTableScroll)}>
        <table>
          <caption>{table.caption}</caption>
          <thead>
            <tr>
              {table.columns.map(({ label }, index) => (
                <th key={index} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, column) => (
                  <td key={column}>{displayCell(value, table.columns[column]?.unit)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={styles.actionButton} onClick={onCopy}>
        <Icon name={copied ? 'check' : 'copy'} size="xs" />
        {copied ? 'Table copied' : 'Copy table'}
      </button>
      {table.rows.length > previewRows && (
        <button
          type="button"
          className={styles.actionButton}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show fewer rows' : `Show all ${table.rows.length} returned rows`}
        </button>
      )}
      {table.total > table.rows.length && (
        <span className={styles.metricSummaryNote}>
          {table.rows.length} of {table.total} equipment shown
        </span>
      )}
    </div>
  );
}
