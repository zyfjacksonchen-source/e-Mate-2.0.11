import type { TenantUsageProjection, UsageMetrics } from '@e-mate/monitoring-contract';

export type UsageTrendPoint = {
  bucketStart: string;
  metrics: UsageMetrics;
};

export type UsageDetail = {
  userId: string;
  modelId: string;
  metrics: UsageMetrics;
};

export type UsageModelTotal = {
  modelId: string;
  callCount: string;
};

export type UsageUserTotal = {
  userId: string;
  modelIds: string[];
  metrics: UsageMetrics;
};

const countFields = [
  'totalRequests',
  'accountedRequests',
  'rejectedRequests',
  'pendingRequests',
  'usageEvents',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'zeroCostUsageEvents',
  'unpricedUsageEvents',
] as const;

function costUnits(value: string): bigint {
  return BigInt(value.replace('.', ''));
}

function costFromUnits(value: bigint): string {
  const digits = value.toString().padStart(13, '0');
  return `${digits.slice(0, -12)}.${digits.slice(-12)}`;
}

export function emptyMetrics(): UsageMetrics {
  return {
    totalRequests: '0',
    accountedRequests: '0',
    rejectedRequests: '0',
    pendingRequests: '0',
    usageEvents: '0',
    inputTokens: '0',
    outputTokens: '0',
    cacheReadTokens: '0',
    cacheWriteTokens: '0',
    totalTokens: '0',
    costUsd: '0.000000000000',
    zeroCostUsageEvents: '0',
    unpricedUsageEvents: '0',
  };
}

export function addMetrics(left: UsageMetrics, right: UsageMetrics): UsageMetrics {
  const counts = Object.fromEntries(
    countFields.map((field) => [field, (BigInt(left[field]) + BigInt(right[field])).toString()])
  ) as Omit<UsageMetrics, 'costUsd'>;
  return {
    ...counts,
    costUsd: costFromUnits(costUnits(left.costUsd) + costUnits(right.costUsd)),
  };
}

export function usageTrend(projection: TenantUsageProjection): UsageTrendPoint[] {
  const buckets = new Map<string, UsageMetrics>();
  for (const group of projection.groups) {
    buckets.set(group.bucketStart, addMetrics(buckets.get(group.bucketStart) ?? emptyMetrics(), group.metrics));
  }
  return [...buckets].map(([bucketStart, metrics]) => ({
    bucketStart,
    metrics,
  }));
}

export function usageDetails(projection: TenantUsageProjection): UsageDetail[] {
  const groups = new Map<string, UsageDetail>();
  for (const group of projection.groups) {
    const key = `${group.userId}\0${group.modelId}`;
    const current = groups.get(key);
    groups.set(key, {
      userId: group.userId,
      modelId: group.modelId,
      metrics: addMetrics(current?.metrics ?? emptyMetrics(), group.metrics),
    });
  }
  // Sorting a fresh array cannot mutate the aggregation map.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...groups.values()].sort((left, right) => {
    const requestDifference = BigInt(right.metrics.totalRequests) - BigInt(left.metrics.totalRequests);
    if (requestDifference !== 0n) return requestDifference > 0n ? 1 : -1;
    return `${left.userId}\0${left.modelId}`.localeCompare(`${right.userId}\0${right.modelId}`);
  });
}

export function usageModels(projection: TenantUsageProjection): UsageModelTotal[] {
  const models = new Map<string, bigint>();
  for (const group of projection.groups) {
    models.set(group.modelId, (models.get(group.modelId) ?? 0n) + BigInt(group.metrics.totalRequests));
  }
  const totals = [...models];
  // Sorting a fresh array cannot mutate the aggregation map.
  // oxlint-disable-next-line unicorn/no-array-sort
  totals.sort((left, right) => {
    const difference = right[1] - left[1];
    return difference === 0n ? left[0].localeCompare(right[0]) : difference > 0n ? 1 : -1;
  });
  return totals.map(([modelId, callCount]) => ({ modelId, callCount: callCount.toString() }));
}

export function usageUsers(projection: TenantUsageProjection): UsageUserTotal[] {
  const users = new Map<string, UsageUserTotal>();
  for (const group of projection.groups) {
    const current = users.get(group.userId);
    users.set(group.userId, {
      userId: group.userId,
      modelIds: current?.modelIds.includes(group.modelId)
        ? current.modelIds
        : [...(current?.modelIds ?? []), group.modelId],
      metrics: addMetrics(current?.metrics ?? emptyMetrics(), group.metrics),
    });
  }
  return [...users.values()].sort((left, right) => {
    const difference = BigInt(right.metrics.totalTokens) - BigInt(left.metrics.totalTokens);
    return difference === 0n ? left.userId.localeCompare(right.userId) : difference > 0n ? 1 : -1;
  });
}

export function hasUsageFacts(projection: TenantUsageProjection): boolean {
  return projection.summary.totalRequests !== '0' || projection.summary.usageEvents !== '0';
}

export function percentage(value: string, total: string): number {
  const denominator = BigInt(total);
  if (denominator === 0n) return 0;
  return Number((BigInt(value) * 1000n) / denominator) / 10;
}

export function callSuccessRate(metrics: UsageMetrics): number | null {
  const completed = BigInt(metrics.accountedRequests) + BigInt(metrics.rejectedRequests);
  return completed === 0n ? null : percentage(metrics.accountedRequests, completed.toString());
}

export function exactCount(value: string, locale: string): string {
  return new Intl.NumberFormat(locale).format(BigInt(value));
}

export function exactCost(value: string, locale: string): string {
  const [integer, fraction = ''] = value.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const formattedInteger = new Intl.NumberFormat(locale).format(BigInt(integer));
  return `$${formattedInteger}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}
