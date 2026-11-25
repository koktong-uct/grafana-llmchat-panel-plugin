import { ChatError } from './types.ts';
import type { TimeRange } from './types.ts';

const singaporeDateTime = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
});

export function formatSingaporeRange({ from, to }: TimeRange): string {
  return `${singaporeDateTime.format(from)} to ${singaporeDateTime.format(to)} Singapore time (end exclusive)`;
}

export function parseRange(from: unknown, to: unknown): TimeRange {
  function parseDate(value: unknown) {
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      return new Date(NaN);
    }
    return new Date(value);
  }
  const range = { from: parseDate(from), to: parseDate(to) };
  if (!(range.to.getTime() > range.from.getTime())) {
    throw new ChatError('The time range is invalid. Provide a start and end time with a timezone.');
  }
  return range;
}
