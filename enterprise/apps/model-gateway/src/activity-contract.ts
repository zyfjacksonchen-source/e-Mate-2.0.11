const datePattern = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const decimalPattern = /^(0|[1-9][0-9]{0,127})$/;
const dayMs = 86_400_000;

export type UsageActivityQuery = {
  timezone: string;
  startDate: string;
  endDate: string;
};

export type UsageActivityLedgerDay = {
  date: string;
  inputTokens: string;
  outputTokens: string;
  cacheReadTokens: string;
  cacheWriteTokens: string;
};

export type UsageActivityDay = {
  date: string;
  total: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export type UsageActivity = {
  schemaVersion: 1;
  timezone: string;
  startDate: string;
  endDate: string;
  days: UsageActivityDay[];
  periodTotal: string;
  calculatedAt: string;
};

function dateMs(value: unknown): number {
  if (typeof value !== 'string' || !datePattern.test(value)) {
    throw new Error('Invalid usage activity query');
  }
  const [year, month, day] = value.split('-').map(Number);
  const result = Date.UTC(year as number, (month as number) - 1, day);
  if (new Date(result).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid usage activity query');
  }
  return result;
}

function timezone(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
    throw new Error('Invalid usage activity query');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error('Invalid usage activity query');
  }
  return value;
}

export function parseUsageActivityQuery(value: {
  timezone?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}): UsageActivityQuery {
  const start = dateMs(value.startDate);
  const end = dateMs(value.endDate);
  if (end < start || (end - start) / dayMs + 1 > 366) {
    throw new Error('Invalid usage activity query');
  }
  return {
    timezone: timezone(value.timezone),
    startDate: value.startDate as string,
    endDate: value.endDate as string,
  };
}

function dates(query: UsageActivityQuery): string[] {
  const start = dateMs(query.startDate);
  const end = dateMs(query.endDate);
  const result: string[] = [];
  for (let current = start; current <= end; current += dayMs) {
    result.push(new Date(current).toISOString().slice(0, 10));
  }
  return result;
}

function count(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !decimalPattern.test(value)) {
    throw new Error(`Invalid usage activity ${label}`);
  }
  return BigInt(value);
}

export function usageActivityDate(value: string | number | Date, timeZone: string): string {
  timezone(timeZone);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('Invalid usage activity timestamp');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function projectUsageActivity(
  query: UsageActivityQuery,
  rows: readonly UsageActivityLedgerDay[],
  calculatedAtInput: string | Date,
): UsageActivity {
  parseUsageActivityQuery(query);
  const calculatedAtDate = new Date(calculatedAtInput);
  if (Number.isNaN(calculatedAtDate.getTime())) throw new Error('Invalid usage activity calculation time');
  const byDate = new Map<string, UsageActivityDay>();
  for (const row of rows) {
    if (byDate.has(row.date)) throw new Error('Duplicate usage activity day');
    const input = count(row.inputTokens, 'input').toString();
    const output = count(row.outputTokens, 'output').toString();
    const cacheRead = count(row.cacheReadTokens, 'cache read').toString();
    const cacheWrite = count(row.cacheWriteTokens, 'cache write').toString();
    byDate.set(row.date, {
      date: row.date,
      total: (BigInt(input) + BigInt(output) + BigInt(cacheRead) + BigInt(cacheWrite)).toString(),
      input,
      output,
      cacheRead,
      cacheWrite,
    });
  }
  const days = dates(query).map(date => byDate.get(date) ?? {
    date,
    total: '0',
    input: '0',
    output: '0',
    cacheRead: '0',
    cacheWrite: '0',
  });
  const dayDates = new Set(days.map(({ date }) => date));
  if (byDate.size !== rows.length || rows.some(row => !dayDates.has(row.date))) {
    throw new Error('Usage activity day is outside its requested range');
  }
  return {
    schemaVersion: 1,
    ...query,
    days,
    periodTotal: days.reduce((total, day) => total + BigInt(day.total), 0n).toString(),
    calculatedAt: calculatedAtDate.toISOString(),
  };
}
