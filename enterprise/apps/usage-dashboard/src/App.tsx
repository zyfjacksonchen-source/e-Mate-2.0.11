import { Alert, Button, Drawer, Empty, Input, Link, Select, Spin, Tag } from '@arco-design/web-react';
import { ChartHistogram, ChartLine, CheckOne, Home, Refresh, UserBusiness } from '@icon-park/react';
import { Fragment, type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { TaskEventType, TaskScenario, TenantUsageEvent } from '@e-mate/monitoring-contract';
import eMateLogo from '../../../../packages/dsh/profile/plugins/emate-shell/assets/emate-logo.png';
import {
  loadUsageDashboard,
  loadUsageEvents,
  loginUsageAccount,
  logoutUsageAccount,
  queryForDateRange,
  queryForDay,
  queryForPeriod,
  queryForYesterday,
  refreshUsageAccount,
  UsageApiError,
  type UsageAuthSession,
  type UsageDashboardData,
  type UsageQuery,
} from './api';
import { messagesFor } from './i18n';
import {
  callSuccessRate,
  emptyMetrics,
  exactCost,
  exactCount,
  tokenCount,
  hasUsageFacts,
  percentage,
  usageModels,
  usageDetails,
  usageTrend,
  usageUserTrend,
  usageUsers,
} from './usage-data';

const TOKEN_SESSION_KEY = 'e-mate.usage.access-token';
const REFRESH_TOKEN_SESSION_KEY = 'e-mate.usage.refresh-token';
const periodOptions = [7, 30, 90] as const;
const usageColumnKeys = [
  'user', 'model', 'status', 'events', 'requests', 'input', 'output', 'cache', 'tokens', 'quota', 'cost',
] as const;
type UsageColumn = (typeof usageColumnKeys)[number];
type ChartMetric = 'activity' | 'requests' | 'tokens';
const scenarioColors: Record<TaskScenario, string> = {
  GENERAL: '#8b8b84',
  CONTENT_CREATION: '#ef6c24',
  DOCUMENT_EDITING: '#4d7cff',
  SYSTEM_MAINTENANCE: '#8b5cf6',
  ASSET_PRODUCTION: '#e8a317',
  DATA_PROCESSING: '#16a085',
  SEARCH_QUERY: '#d44f73',
};

function localDate(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function clearUsageSession() {
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_SESSION_KEY);
}

type DashboardState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: UsageDashboardData }
  | { kind: 'error'; status: number | null };

type EventState =
  | { kind: 'idle'; events: TenantUsageEvent[] }
  | { kind: 'loading'; events: TenantUsageEvent[] }
  | { kind: 'ready'; events: TenantUsageEvent[]; nextCursor: string | null }
  | { kind: 'error'; events: TenantUsageEvent[] };

type DayDetailState = { kind: 'idle' } | DashboardState;

function MetricCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function DistributionRow({
  label,
  value,
  maximum,
  locale,
}: {
  label: string;
  value: string;
  maximum: string;
  locale: string;
}) {
  return (
    <div className='distribution-row'>
      <div>
        <span>{label}</span>
        <strong>{exactCount(value, locale)}</strong>
      </div>
      <div className='distribution-track' aria-hidden='true'>
        <span style={{ width: `${percentage(value, maximum)}%` }} />
      </div>
    </div>
  );
}

function errorMessage(status: number | null, copy: ReturnType<typeof messagesFor>): string {
  if (status === 401) return copy.authFailed;
  if (status === 403) return copy.accessDenied;
  return copy.loadFailed;
}

function maxCount(values: string[]): string {
  return values.reduce((maximum, value) => (BigInt(value) > BigInt(maximum) ? value : maximum), '0');
}

export function App() {
  const locale = navigator.language || 'zh-CN';
  const copy = messagesFor(locale);
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_SESSION_KEY) ?? '');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [period, setPeriod] = useState<(typeof periodOptions)[number] | 'yesterday' | 'custom'>(7);
  const [range, setRange] = useState<UsageQuery>(() => queryForPeriod(7));
  const [customFrom, setCustomFrom] = useState(() => localDate(new Date(Date.now() - 6 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => localDate(new Date()));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [knownUsers, setKnownUsers] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('activity');
  const [usageColumns, setUsageColumns] = useState<UsageColumn[]>(() => [...usageColumnKeys]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardState>({ kind: 'loading' });
  const [selectedDayQuery, setSelectedDayQuery] = useState<UsageQuery | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailState>({ kind: 'idle' });
  const [eventsOpen, setEventsOpen] = useState(false);
  const [eventState, setEventState] = useState<EventState>({ kind: 'idle', events: [] });
  const pendingRefresh = useRef<Promise<UsageAuthSession> | null>(null);
  const customFromInput = useRef<HTMLInputElement>(null);
  const customToInput = useRef<HTMLInputElement>(null);
  const authBase = import.meta.env.VITE_AUTH_API_BASE as string | undefined;
  const authClientId = (import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined) ?? 'e-mate-admin';

  const refreshUsageSession = (signal: AbortSignal): Promise<UsageAuthSession> => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY);
    if (!refreshToken) return Promise.reject(new UsageApiError(401));
    pendingRefresh.current ??= refreshUsageAccount(
      {
        authBase,
        clientId: authClientId,
        refreshToken,
        refreshRequestId: crypto.randomUUID(),
      },
      signal,
      { origin: window.location.origin }
    ).then((session) => {
      if (sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY) !== refreshToken) throw new UsageApiError(401);
      sessionStorage.setItem(TOKEN_SESSION_KEY, session.accessToken);
      sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, session.refreshToken);
      return session;
    }).finally(() => {
      pendingRefresh.current = null;
    });
    return pendingRefresh.current;
  };

  useEffect(() => {
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    const syncThemeLabel = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    systemTheme.addEventListener('change', syncThemeLabel);
    return () => systemTheme.removeEventListener('change', syncThemeLabel);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const query = { ...range, ...(selectedUserIds.length ? { userIds: selectedUserIds } : {}) };
    setDashboard({ kind: 'loading' });
    void loadUsageDashboard(token, query, controller.signal)
      .then((data) => {
        setTokenError(null);
        setKnownUsers((current) => {
          const users = new Map(current.map((user) => [user.userId, user]));
          for (const user of data.users ?? []) users.set(user.userId, { userId: user.userId, displayName: user.displayName });
          for (const { userId } of data.projection.groups) {
            if (!users.has(userId)) users.set(userId, { userId, displayName: userId });
          }
          for (const { userId } of data.taskSummary.userEventCounts) {
            if (!users.has(userId)) users.set(userId, { userId, displayName: userId });
          }
          return [...users.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
        });
        setDashboard({ kind: 'ready', data });
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        const status = error instanceof UsageApiError ? error.status : null;
        if (status === 401) {
          try {
            const session = await refreshUsageSession(controller.signal);
            if (!controller.signal.aborted) setToken(session.accessToken);
            return;
          } catch {
            clearUsageSession();
            setToken('');
            setKnownUsers([]);
            setSelectedUserIds([]);
            setTokenError(copy.authFailed);
          }
        }
        setDashboard({ kind: 'error', status });
      });
    return () => controller.abort();
  }, [copy.authFailed, range.bucket, range.from, range.timezone, range.to, reloadKey, selectedUserIds, token]);

  useEffect(() => {
    if (!token || !selectedDayQuery) {
      setDayDetail({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setDayDetail({ kind: 'loading' });
    void loadUsageDashboard(token, selectedDayQuery, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDayDetail({ kind: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDayDetail({ kind: 'error', status: error instanceof UsageApiError ? error.status : null });
        }
      });
    return () => controller.abort();
  }, [reloadKey, selectedDayQuery, token]);

  const resetEvents = () => {
    setEventsOpen(false);
    setEventState({ kind: 'idle', events: [] });
  };

  const resetDayDetail = () => {
    setSelectedDayQuery(null);
    setDayDetail({ kind: 'idle' });
  };

  const selectPeriod = (value: (typeof periodOptions)[number] | 'yesterday' | 'custom') => {
    setPeriod(value);
    setRangeError(null);
    resetEvents();
    resetDayDetail();
    if (value === 'yesterday') setRange(queryForYesterday());
    else if (value !== 'custom') setRange(queryForPeriod(value));
  };

  const applyCustomRange = () => {
    const fromValue = customFromInput.current?.value ?? customFrom;
    const toValue = customToInput.current?.value ?? customTo;
    try {
      setRange(queryForDateRange(fromValue, toValue));
      setCustomFrom(fromValue);
      setCustomTo(toValue);
      setRangeError(null);
      resetEvents();
      resetDayDetail();
    } catch {
      setRangeError(copy.invalidRange);
    }
  };

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    if (!account.trim() || !password) {
      setTokenError(copy.tokenRequired);
      return;
    }
    const controller = new AbortController();
    setLoginBusy(true);
    setTokenError(null);
    void loginUsageAccount(
      {
        authBase,
        clientId: authClientId,
        organization: (import.meta.env.VITE_AUTH_ORGANIZATION as string | undefined) ?? 'emate-v2',
        account: account.trim(),
        password,
      },
      controller.signal,
      { origin: window.location.origin }
    )
      .then((session) => {
        sessionStorage.setItem(TOKEN_SESSION_KEY, session.accessToken);
        sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, session.refreshToken);
        setKnownUsers([]);
        setSelectedUserIds([]);
        setToken(session.accessToken);
        setPassword('');
      })
      .catch((error: unknown) => {
        setTokenError(error instanceof UsageApiError && error.status === 403 ? copy.accessDenied : copy.authFailed);
      })
      .finally(() => setLoginBusy(false));
  };

  const signOut = () => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY);
    clearUsageSession();
    setToken('');
    setKnownUsers([]);
    setSelectedUserIds([]);
    if (!refreshToken) return;
    void logoutUsageAccount(
      {
        authBase,
        clientId: authClientId,
        refreshToken,
        clientRequestId: crypto.randomUUID(),
      },
      new AbortController().signal,
      { origin: window.location.origin }
    ).catch(() => undefined);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.body.setAttribute('arco-theme', next);
    try {
      localStorage.setItem('e-mate.usage.theme', next);
    } catch {
      // The visible theme still changes when storage is unavailable.
    }
    setTheme(next);
  };

  if (!token) {
    return (
      <main className='auth-shell'>
        <section className='auth-card' aria-labelledby='auth-title'>
          <div className='auth-brand'>
            <img src={eMateLogo} alt={copy.product} />
          </div>
          <h1 id='auth-title'>{copy.tokenTitle}</h1>
          <p>{copy.tokenDescription}</p>
          <Button onClick={toggleTheme} aria-label={theme === 'dark' ? copy.lightTheme : copy.darkTheme}>
            {theme === 'dark' ? copy.lightTheme : copy.darkTheme}
          </Button>
          <form onSubmit={submitToken}>
            <label htmlFor='usage-account'>{copy.account}</label>
            <Input
              id='usage-account'
              value={account}
              autoComplete='username'
              placeholder={copy.accountPlaceholder}
              onChange={setAccount}
            />
            <label htmlFor='usage-password'>{copy.password}</label>
            <Input.Password
              id='usage-password'
              value={password}
              autoComplete='current-password'
              placeholder={copy.passwordPlaceholder}
              onChange={setPassword}
              visibilityToggle
            />
            {tokenError && <Alert type='error' content={tokenError} showIcon />}
            <Button type='primary' htmlType='submit' loading={loginBusy} long>
              {copy.connect}
            </Button>
          </form>
        </section>
      </main>
    );
  }

  const ready = dashboard.kind === 'ready' ? dashboard.data : null;
  const projection = ready?.projection;
  const reconciliation = ready?.reconciliation;
  const taskSummary = ready?.taskSummary;
  const trends = projection ? usageTrend(projection) : [];
  const userTrends = projection ? usageUserTrend(projection) : [];
  const models = projection ? usageModels(projection) : [];
  const userUsage = projection ? usageUsers(projection) : [];
  const displayNameByUserId = new Map(knownUsers.map(({ userId, displayName }) => [userId, displayName]));
  const visibleAuditUserIds = ready?.users?.map(({ userId }) => userId) ?? [];
  const scopedUserIds = selectedUserIds.length ? selectedUserIds : visibleAuditUserIds;
  const selectedUserSet = new Set(selectedUserIds);
  const userUsageById = new Map(userUsage.map((entry) => [entry.userId, entry]));
  const userEventCountById = new Map(
    (taskSummary?.userEventCounts ?? []).map((entry) => [entry.userId, entry.eventCount])
  );
  const configuredUserIds = new Set(ready?.users?.map(({ userId }) => userId) ?? []);
  const knownUserIds = new Set([...configuredUserIds, ...userUsageById.keys()]);
  const userRows = (ready?.users
    ? [
        ...ready.users.map((user) => ({
          userId: user.userId,
          displayName: user.displayName,
          status: user.status,
          tokenLimit: user.tokenLimit,
          eventCount: userEventCountById.get(user.userId) ?? '0',
          ...(userUsageById.get(user.userId) ?? { modelIds: [], metrics: emptyMetrics() }),
        })),
        ...userUsage
          .filter(({ userId }) => !configuredUserIds.has(userId))
          .map((entry) => ({
            ...entry,
            displayName: entry.userId,
            status: null,
            tokenLimit: undefined,
            eventCount: userEventCountById.get(entry.userId) ?? '0',
          })),
        ...(taskSummary?.userEventCounts ?? [])
          .filter(({ userId }) => !knownUserIds.has(userId))
          .map(({ userId, eventCount }) => ({
            userId,
            displayName: userId,
            status: null,
            tokenLimit: undefined,
            eventCount,
            modelIds: [],
            metrics: emptyMetrics(),
          })),
      ]
    : [
        ...userUsage.map((entry) => ({
          ...entry,
          displayName: entry.userId,
          status: null,
          tokenLimit: undefined,
          eventCount: userEventCountById.get(entry.userId) ?? '0',
        })),
        ...(taskSummary?.userEventCounts ?? [])
          .filter(({ userId }) => !userUsageById.has(userId))
          .map(({ userId, eventCount }) => ({
            userId,
            displayName: userId,
            status: null,
            tokenLimit: undefined,
            eventCount,
            modelIds: [],
            metrics: emptyMetrics(),
          })),
      ]).filter(({ userId }) => selectedUserSet.size === 0 || selectedUserSet.has(userId));
  const maximumRequests = maxCount(trends.map(({ metrics }) => metrics.totalRequests));
  const maximumTokens = maxCount(trends.map(({ metrics }) => metrics.totalTokens));
  const chartValue = (metrics: (typeof userTrends)[number]['metrics']) =>
    chartMetric === 'requests' ? metrics.totalRequests : metrics.totalTokens;
  const chartValueForUser = (row: (typeof userRows)[number]) =>
    chartMetric === 'activity' ? row.eventCount : chartValue(row.metrics);
  const chartUsers = userRows
    .filter(
      ({ eventCount, metrics }) =>
        BigInt(eventCount) > 0n || BigInt(metrics.totalRequests) > 0n || BigInt(metrics.totalTokens) > 0n
    )
    .sort((left, right) => {
      const difference = BigInt(chartValueForUser(right)) - BigInt(chartValueForUser(left));
      return difference === 0n ? left.userId.localeCompare(right.userId) : difference > 0n ? 1 : -1;
    });
  const chartUserIds = new Set(chartUsers.map(({ userId }) => userId));
  const visibleUserTrends = userTrends.filter(({ userId }) => chartUserIds.has(userId));
  const userTrendByKey = new Map(visibleUserTrends.map((entry) => [`${entry.bucketStart}\0${entry.userId}`, entry]));
  const maximumUserTrend = chartMetric === 'activity'
    ? maxCount(chartUsers.map(({ eventCount }) => eventCount))
    : maxCount(visibleUserTrends.map(({ metrics }) => chartValue(metrics)));
  const maximumModelCalls = maxCount(models.map(({ callCount }) => callCount));
  const taskSourceReady = taskSummary?.sourceState === 'AUTHORITATIVE';
  const usageSourceReady = projection ? hasUsageFacts(projection) : false;
  const maximumTaskEvents = taskSummary
    ? maxCount(taskSummary.eventTypeCounts.map(({ eventCount }) => eventCount))
    : '0';
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: projection?.timezone,
    }).format(new Date(value));
  const day = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      timeZone: projection?.timezone,
    }).format(new Date(value));
  const completedCalls = projection
    ? (BigInt(projection.summary.accountedRequests) + BigInt(projection.summary.rejectedRequests)).toString()
    : '0';
  const successRate = projection ? callSuccessRate(projection.summary) : null;
  const taskActiveUserIds = new Set(
    (taskSummary?.userEventCounts ?? [])
      .filter(({ eventCount }) => BigInt(eventCount) > 0n)
      .map(({ userId }) => userId)
  );
  const meteredUserIds = new Set(projection?.groups.map(({ userId }) => userId) ?? []);
  const activeUserIds = new Set([...taskActiveUserIds, ...meteredUserIds]);
  const activeUsers = activeUserIds.size.toString();
  const unmeteredTaskUsers = [...taskActiveUserIds].filter((userId) => !meteredUserIds.has(userId));
  const dayData = dayDetail.kind === 'ready' ? dayDetail.data : null;
  const dayTaskSummary = dayData?.taskSummary;
  const dayUsageRows = dayData ? usageDetails(dayData.projection) : [];
  const visibleScenarioCounts = taskSummary?.scenarioCounts.filter(({ taskCount }) => taskCount !== '0') ?? [];
  const dayVisibleScenarioCounts = dayTaskSummary?.scenarioCounts.filter(({ taskCount }) => taskCount !== '0') ?? [];
  const hasUnclassifiedTasks = visibleScenarioCounts.some(({ scenario }) => scenario === 'GENERAL');
  const dayHasUnclassifiedTasks = dayVisibleScenarioCounts.some(({ scenario }) => scenario === 'GENERAL');
  const scenarioBuckets = new Map<string, Map<TaskScenario, string>>();
  for (const { bucketStart, scenario, taskCount } of taskSummary?.scenarioBuckets ?? []) {
    const counts = scenarioBuckets.get(bucketStart) ?? new Map<TaskScenario, string>();
    counts.set(scenario, taskCount);
    scenarioBuckets.set(bucketStart, counts);
  }
  const scenarioTrendRows = [...scenarioBuckets]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucketStart, counts]) => ({
      bucketStart,
      counts,
      total: [...counts.values()].reduce((total, value) => total + BigInt(value), 0n).toString(),
    }));
  const maximumScenarioTasks = maxCount(scenarioTrendRows.map(({ total }) => total));
  const scenarioLabels: Record<TaskScenario, string> = {
    GENERAL: copy.taxonomyGeneral,
    CONTENT_CREATION: copy.taxonomyCreative,
    DOCUMENT_EDITING: copy.taxonomyDocument,
    SYSTEM_MAINTENANCE: copy.taxonomySystem,
    ASSET_PRODUCTION: copy.taxonomyMaterial,
    DATA_PROCESSING: copy.taxonomyData,
    SEARCH_QUERY: copy.taxonomySearch,
  };
  const usageColumnLabels: Record<UsageColumn, string> = {
    user: copy.user,
    model: copy.model,
    status: copy.userStatus,
    events: copy.userEventCount,
    requests: copy.requests,
    input: copy.inputTokens,
    output: copy.outputTokens,
    cache: copy.cacheTokens,
    tokens: copy.totalTokens,
    quota: copy.configuredQuota,
    cost: copy.cost,
  };
  const eventTypeLabels: Record<TaskEventType, string> = {
    RECEIVED: copy.eventReceived,
    FIRST_RESPONSE: copy.eventFirstResponse,
    COMPLETED: copy.eventCompleted,
    FAILED: copy.eventFailed,
    CANCELLED: copy.eventCancelled,
    SKILL_SELECTED: copy.eventSkillSelected,
    TOOL_SELECTED: copy.eventToolSelected,
    TOOL_EXECUTION: copy.eventToolExecution,
    PERMISSION_REQUESTED: copy.eventPermissionRequested,
    ARTIFACT_UPDATED: copy.eventArtifactUpdated,
    WAITING_INPUT: copy.eventWaitingInput,
  };
  const userStatusLabel = (status: string | null) => {
    if (status === 'ACTIVE') return copy.active;
    if (status === 'PENDING_APPROVAL') return copy.pendingApproval;
    if (status === 'SUSPENDED') return copy.suspended;
    if (status === 'DELETED') return copy.deleted;
    return '—';
  };
  const renderUsageCell = (column: UsageColumn, row: (typeof userRows)[number]): ReactNode => {
    if (column === 'user') return <><strong>{row.displayName}</strong><small className='table-subline'>{row.userId}</small></>;
    if (column === 'model') return row.modelIds.join(', ') || '—';
    if (column === 'status') return userStatusLabel(row.status);
    if (column === 'events') return exactCount(row.eventCount, locale);
    if (column === 'requests') return exactCount(row.metrics.totalRequests, locale);
    if (column === 'input') return tokenCount(row.metrics.inputTokens);
    if (column === 'output') return tokenCount(row.metrics.outputTokens);
    if (column === 'cache') {
      return tokenCount((BigInt(row.metrics.cacheReadTokens) + BigInt(row.metrics.cacheWriteTokens)).toString());
    }
    if (column === 'cost') return exactCost(row.metrics.costUsd, locale);
    if (row.tokenLimit === undefined) return copy.quotaUnavailable;
    if (row.tokenLimit === null) return copy.unlimited;
    if (column === 'quota') {
      return <span className='quota-cell'>{tokenCount(String(row.tokenLimit))}<small>{copy.weeklyQuota}</small></span>;
    }
    return tokenCount(row.metrics.totalTokens);
  };
  const eventQuery = projection
    ? (selectedDayQuery ?? {
        from: projection.from,
        to: projection.to,
        timezone: projection.timezone,
        bucket: projection.bucket,
        ...(scopedUserIds.length ? { userIds: scopedUserIds } : {}),
      } satisfies UsageQuery)
    : null;
  const toggleDayDetail = (bucketStart: string) => {
    resetEvents();
    if (selectedDayQuery?.from === bucketStart) {
      resetDayDetail();
      return;
    }
    if (!projection) return;
    setSelectedDayQuery(queryForDay(bucketStart, projection.to, projection.timezone, scopedUserIds));
  };
  const loadEventPage = (cursor: string | null, existing: TenantUsageEvent[]) => {
    if (!projection || !eventQuery) return;
    const controller = new AbortController();
    setEventState({ kind: 'loading', events: existing });
    void loadUsageEvents(token, eventQuery, cursor, controller.signal, projection.tenantId)
      .then((page) => setEventState({ kind: 'ready', events: [...existing, ...page.events], nextCursor: page.nextCursor }))
      .catch(async (error: unknown) => {
        if (error instanceof UsageApiError && error.status === 401) {
          try {
            const session = await refreshUsageSession(controller.signal);
            const page = await loadUsageEvents(
              session.accessToken,
              eventQuery,
              cursor,
              controller.signal,
              projection.tenantId
            );
            setToken(session.accessToken);
            setEventState({ kind: 'ready', events: [...existing, ...page.events], nextCursor: page.nextCursor });
            return;
          } catch {
            clearUsageSession();
            setToken('');
            setEventsOpen(false);
          }
        }
        setEventState({ kind: 'error', events: existing });
      });
  };
  const openEvents = () => {
    setEventsOpen(true);
    loadEventPage(null, []);
  };
  const dayDetailPanel = selectedDayQuery ? (
    <section className='day-detail' aria-live='polite'>
      <div className='day-detail-heading'>
        <div>
          <h3>{copy.dayDetails} · {day(selectedDayQuery.from)}</h3>
          <p>{copy.dayDetailsDescription}</p>
        </div>
        <Button size='small' onClick={resetDayDetail}>{copy.close}</Button>
      </div>
      {dayDetail.kind === 'loading' && <Spin dot />}
      {dayDetail.kind === 'error' && <Alert type='error' content={copy.loadFailed} showIcon />}
      {dayData && dayTaskSummary && (
        <>
          <div className='day-detail-grid'>
            <section>
              <h4>{copy.eventDistribution}</h4>
              <div className='taxonomy-grid'>
                {dayTaskSummary.eventTypeCounts
                  .filter(({ eventCount }) => eventCount !== '0')
                  .map(({ type, eventCount }) => (
                    <span key={type}>{eventTypeLabels[type]}<small>{exactCount(eventCount, locale)}</small></span>
                  ))}
              </div>
            </section>
            <section>
              <h4>{copy.taskDistribution}</h4>
              {dayHasUnclassifiedTasks && <p className='source-empty'>{copy.unclassifiedScenarioNotice}</p>}
              <div className='taxonomy-grid'>
                {dayVisibleScenarioCounts.map(({ scenario, taskCount }) => (
                  <span key={scenario}>{scenarioLabels[scenario]}<small>{exactCount(taskCount, locale)}</small></span>
                ))}
              </div>
            </section>
          </div>
          <div className='table-scroll day-usage-table'>
            <h4>{copy.details}</h4>
            <table>
              <thead><tr><th>{copy.user}</th><th>{copy.model}</th><th>{copy.requests}</th><th>{copy.totalTokens}</th><th>{copy.cost}</th></tr></thead>
              <tbody>
                {dayUsageRows.map((row) => (
                  <tr key={`${row.userId}:${row.modelId}`}>
                    <td>
                      <strong>{displayNameByUserId.get(row.userId) ?? row.userId}</strong>
                      {displayNameByUserId.has(row.userId) &&
                        displayNameByUserId.get(row.userId) !== row.userId && (
                        <small className='table-subline'>{row.userId}</small>
                      )}
                    </td><td>{row.modelId}</td>
                    <td>{exactCount(row.metrics.totalRequests, locale)}</td>
                    <td>{tokenCount(row.metrics.totalTokens)}</td>
                    <td>{exactCost(row.metrics.costUsd, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dayUsageRows.length === 0 && <Empty description={copy.noData} />}
          </div>
        </>
      )}
    </section>
  ) : null;
  const mismatchCount = reconciliation
    ? Object.values(reconciliation.checks)
        .reduce((total, value) => total + BigInt(value), 0n)
        .toString()
    : '0';

  return (
    <div className='dashboard-shell'>
      <aside className='sidebar'>
        <div className='sidebar-brand'>
          <img src={eMateLogo} alt={copy.product} />
        </div>
        <nav aria-label={copy.overview}>
          <Link className='is-active' href='#overview' aria-current='page'>
            <Home size={20} />
            <span>{copy.overview}</span>
          </Link>
          <Link href='#trend'>
            <ChartHistogram size={20} />
            <span>{copy.usage}</span>
          </Link>
          <Link href='#users'>
            <UserBusiness size={20} />
            <span>{copy.users}</span>
          </Link>
          <Link href='#audit'>
            <CheckOne size={20} />
            <span>{copy.audit}</span>
          </Link>
        </nav>
        <Button className='sign-out' type='text' onClick={signOut}>
          {copy.signOut}
        </Button>
      </aside>

      <main className='dashboard-main' id='overview'>
        <header className='dashboard-header'>
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <div className='header-actions'>
            <Button onClick={toggleTheme} aria-label={theme === 'dark' ? copy.lightTheme : copy.darkTheme}>
              {theme === 'dark' ? copy.lightTheme : copy.darkTheme}
            </Button>
            <Button
              icon={<Refresh />}
              onClick={() => {
                if (period === 'custom') setReloadKey((value) => value + 1);
                else setRange(period === 'yesterday' ? queryForYesterday() : queryForPeriod(period));
              }}
              loading={dashboard.kind === 'loading'}
            >
              {copy.refresh}
            </Button>
          </div>
        </header>

        <section className='filter-bar' aria-label={copy.filters}>
          <div className='period-filter'>
            <span>{copy.period}</span>
            <div className='period-buttons' role='group' aria-label={copy.period}>
              {(
                [
                  ['yesterday', copy.yesterday],
                  [7, copy.last7Days],
                  [30, copy.last30Days],
                  [90, copy.last90Days],
                  ['custom', copy.customRange],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type={period === value ? 'primary' : 'secondary'}
                  onClick={() => selectPeriod(value)}
                  aria-pressed={period === value}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {period === 'custom' && (
            <div className='custom-range'>
              <label>
                <span>{copy.from}</span>
                <input
                  ref={customFromInput}
                  type='date'
                  max={localDate(new Date())}
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.to}</span>
                <input
                  ref={customToInput}
                  type='date'
                  max={localDate(new Date())}
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
              <Button onClick={applyCustomRange}>{copy.apply}</Button>
            </div>
          )}
          <label className='user-filter'>
            <span>{copy.userFilter}</span>
            <Select
              mode='multiple'
              value={selectedUserIds}
              placeholder={copy.allUsers}
              allowClear
              showSearch
              onChange={(value) => {
                resetEvents();
                resetDayDetail();
                setSelectedUserIds(value as string[]);
              }}
              aria-label={copy.userFilter}
            >
              {knownUsers.map((user) => (
                <Select.Option value={user.userId} key={user.userId}>
                  {user.displayName === user.userId ? user.userId : `${user.displayName} · ${user.userId}`}
                </Select.Option>
              ))}
            </Select>
          </label>
          {selectedUserIds.length > 0 && <Tag>{copy.filteredUsers}: {selectedUserIds.length}</Tag>}
        </section>
        {rangeError && <Alert className='dashboard-alert' type='error' content={rangeError} showIcon />}

        {dashboard.kind === 'error' && (
          <Alert
            className='dashboard-alert'
            type='error'
            content={errorMessage(dashboard.status, copy)}
            action={
              <Button size='small' onClick={() => setReloadKey((value) => value + 1)}>
                {copy.retry}
              </Button>
            }
            showIcon
          />
        )}

        {dashboard.kind === 'loading' && (
          <div className='loading-state' aria-live='polite'>
            <Spin dot />
          </div>
        )}

        {projection && reconciliation && taskSummary && (
          <>
            <section className='source-strip' aria-label={copy.rawSource}>
              <span>{copy.rawSource}</span>
              <Tag color={reconciliation.state === 'MATCHED' ? 'green' : 'orange'}>
                {reconciliation.state === 'MATCHED' ? copy.matched : copy.mismatched}
              </Tag>
              <Tag>
                {copy.updatedAt} {dateTime(projection.generatedAt)}
              </Tag>
              <span className='tenant-label'>
                {copy.tenant}: {projection.tenantId}
              </span>
            </section>

            <section className='metric-grid' aria-label={copy.title}>
              <MetricCard
                label={copy.tasks}
                value={taskSourceReady ? exactCount(taskSummary.summary.receivedTasks, locale) : '—'}
                detail={taskSourceReady ? copy.taskScope : copy.taskScopeUnavailable}
              />
              <MetricCard
                label={copy.requests}
                value={usageSourceReady ? exactCount(projection.summary.totalRequests, locale) : '—'}
                detail={
                  usageSourceReady
                    ? `${exactCount(projection.summary.pendingRequests, locale)} ${copy.pending}`
                    : copy.noData
                }
              />
              <MetricCard
                label={copy.totalTokens}
                value={usageSourceReady ? tokenCount(projection.summary.totalTokens) : '—'}
                detail={
                  usageSourceReady
                    ? copy.tokenComposition
                    : copy.noData
                }
              />
              <MetricCard
                label={copy.activeUsers}
                value={taskSourceReady || usageSourceReady ? exactCount(activeUsers, locale) : '—'}
                detail={
                  taskSourceReady || usageSourceReady
                    ? copy.activeUsersScope
                    : copy.noData
                }
              />
            </section>

            {taskSourceReady && unmeteredTaskUsers.length > 0 && (
              <Alert
                className='dashboard-alert'
                type='warning'
                content={`${copy.usageCoverageWarning} ${copy.taskLedgerUsers}: ${exactCount(
                  taskActiveUserIds.size.toString(),
                  locale
                )}; ${copy.meteredUsers}: ${exactCount(meteredUserIds.size.toString(), locale)}.`}
                showIcon
              />
            )}

            {successRate !== null && (
              <p className='accuracy-note summary-note'>
                {copy.callSuccessRate}: {successRate}% · {exactCount(projection.summary.accountedRequests, locale)}{' '}
                {copy.accounted} / {exactCount(completedCalls, locale)} {copy.completedCalls}
              </p>
            )}

            <section className='analysis-grid'>
              <article className='panel trend-panel' id='trend'>
                <div className='panel-heading'>
                  <div>
                    <h2>{copy.trend}</h2>
                    <p>{copy.trendDescription}</p>
                  </div>
                  <div className='chart-toolbar'>
                    <label>
                      <span>{copy.chartMetric}</span>
                      <select
                        aria-label={copy.chartMetric}
                        value={chartMetric}
                        onChange={(event) => setChartMetric(event.currentTarget.value as ChartMetric)}
                      >
                        <option value='activity'>{copy.activityMetric}</option>
                        <option value='requests'>{copy.callsMetric}</option>
                        <option value='tokens'>{copy.tokensMetric}</option>
                      </select>
                    </label>
                    <ChartLine size={22} />
                  </div>
                </div>
                {trends.length === 0 ? (
                  <Empty description={copy.noData} />
                ) : (
                  <div className='trend-list'>
                    <div className='analysis-charts'>
                      <section className='analysis-chart-card'>
                        <div className='analysis-chart-heading'>
                          <div>
                            <h3>{copy.userTrend}</h3>
                            <p>
                              {chartMetric === 'activity'
                                ? copy.activityUserTrendDescription
                                : copy.userTrendDescription}
                            </p>
                          </div>
                          <small>{copy.topUsersNotice}</small>
                        </div>
                        {chartUsers.length === 0 ? (
                          <Empty description={copy.noData} />
                        ) : (
                          <div className='usage-heatmap-scroll'>
                            <div
                              className='usage-heatmap-header'
                              style={{
                                gridTemplateColumns: chartMetric === 'activity'
                                  ? 'minmax(132px, 180px) minmax(120px, 1fr)'
                                  : `minmax(132px, 180px) repeat(${trends.length}, minmax(58px, 1fr))`,
                              }}
                            >
                              <span>{copy.user}</span>
                              {chartMetric === 'activity'
                                ? <span>{copy.selectedRangeTotal}</span>
                                : trends.map(({ bucketStart }) => <time key={bucketStart}>{day(bucketStart)}</time>)}
                            </div>
                            {chartUsers.map((user) => (
                              <div
                                className='usage-heatmap-row'
                                key={user.userId}
                                style={{
                                  gridTemplateColumns: chartMetric === 'activity'
                                    ? 'minmax(132px, 180px) minmax(120px, 1fr)'
                                    : `minmax(132px, 180px) repeat(${trends.length}, minmax(58px, 1fr))`,
                                }}
                              >
                                <strong title={user.userId}>
                                  {displayNameByUserId.get(user.userId) ?? user.displayName}
                                </strong>
                                {chartMetric === 'activity' ? (
                                  <span
                                    className='usage-heat-cell'
                                    title={`${displayNameByUserId.get(user.userId) ?? user.displayName} · ${copy.selectedRangeTotal} · ${exactCount(user.eventCount, locale)}`}
                                    style={{
                                      backgroundColor: user.eventCount === '0'
                                        ? 'var(--color-raised)'
                                        : `color-mix(in srgb, var(--color-brand) ${Math.max(
                                            12,
                                            percentage(user.eventCount, maximumUserTrend)
                                          )}%, var(--color-raised))`,
                                    }}
                                  >
                                    {exactCount(user.eventCount, locale)}
                                  </span>
                                ) : trends.map(({ bucketStart }) => {
                                  const value = chartValue(
                                    userTrendByKey.get(`${bucketStart}\0${user.userId}`)?.metrics ?? emptyMetrics()
                                  );
                                  const intensity = percentage(value, maximumUserTrend);
                                  return (
                                    <span
                                      className='usage-heat-cell'
                                      key={bucketStart}
                                      title={`${displayNameByUserId.get(user.userId) ?? user.displayName} · ${day(bucketStart)} · ${
                                        chartMetric === 'requests' ? exactCount(value, locale) : `${tokenCount(value)} Token`
                                      }`}
                                      style={{
                                        backgroundColor: value === '0'
                                          ? 'var(--color-raised)'
                                          : `color-mix(in srgb, var(--color-brand) ${Math.max(12, intensity)}%, var(--color-raised))`,
                                      }}
                                    >
                                      {chartMetric === 'requests' ? exactCount(value, locale) : tokenCount(value)}
                                    </span>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className='analysis-chart-card'>
                        <div className='analysis-chart-heading'>
                          <div>
                            <h3>{copy.scenarioTrend}</h3>
                            <p>{copy.scenarioTrendDescription}</p>
                          </div>
                        </div>
                        {hasUnclassifiedTasks && <p className='source-empty'>{copy.unclassifiedScenarioNotice}</p>}
                        <div className='scenario-legend'>
                          {visibleScenarioCounts.map(({ scenario }) => (
                            <span key={scenario} style={{ '--scenario-color': scenarioColors[scenario] } as CSSProperties}>
                              {scenarioLabels[scenario]}
                            </span>
                          ))}
                        </div>
                        <div className='scenario-trend-list'>
                          {scenarioTrendRows.map(({ bucketStart, counts, total }) => (
                            <div className='scenario-trend-row' key={bucketStart}>
                              <time>{day(bucketStart)}</time>
                              <div className='scenario-track'>
                                <div className='scenario-total' style={{ width: `${percentage(total, maximumScenarioTasks)}%` }}>
                                  {visibleScenarioCounts.map(({ scenario }) => (
                                    <span
                                      key={scenario}
                                      title={`${scenarioLabels[scenario]} · ${exactCount(counts.get(scenario) ?? '0', locale)}`}
                                      style={{
                                        width: `${percentage(counts.get(scenario) ?? '0', total)}%`,
                                        backgroundColor: scenarioColors[scenario],
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                              <strong>{exactCount(total, locale)}</strong>
                            </div>
                          ))}
                        </div>
                        {scenarioTrendRows.length === 0 && <Empty description={copy.noData} />}
                      </section>
                    </div>

                    <div className='trend-legend' aria-hidden='true'>
                      <span className='accounted-dot'>{copy.accounted}</span>
                      <span className='rejected-dot'>{copy.rejected}</span>
                      <span className='pending-dot'>{copy.pending}</span>
                      <span className='token-dot'>{copy.totalTokens}</span>
                    </div>
                    <p className='trend-hint'>{copy.clickDayForDetails}</p>
                    {trends.map(({ bucketStart, metrics }) => {
                      const totalWidth = percentage(metrics.totalRequests, maximumRequests);
                      return (
                        <Fragment key={bucketStart}>
                          <button
                            type='button'
                            className={`trend-row${selectedDayQuery?.from === bucketStart ? ' is-selected' : ''}`}
                            onClick={() => toggleDayDetail(bucketStart)}
                            aria-expanded={selectedDayQuery?.from === bucketStart}
                          >
                            <time dateTime={bucketStart}>{day(bucketStart)}</time>
                            <div className='trend-bars'>
                              <div
                                className='trend-track'
                                role='img'
                                aria-label={`${day(bucketStart)}: ${copy.accounted} ${metrics.accountedRequests}, ${copy.rejected} ${metrics.rejectedRequests}, ${copy.pending} ${metrics.pendingRequests}`}
                              >
                                <div
                                  className='trend-total'
                                  style={
                                    {
                                      '--trend-total': `${totalWidth}%`,
                                    } as CSSProperties
                                  }
                                >
                                  <span
                                    className='trend-accounted'
                                    style={{ width: `${percentage(metrics.accountedRequests, metrics.totalRequests)}%` }}
                                  />
                                  <span
                                    className='trend-rejected'
                                    style={{ width: `${percentage(metrics.rejectedRequests, metrics.totalRequests)}%` }}
                                  />
                                  <span
                                    className='trend-pending'
                                    style={{ width: `${percentage(metrics.pendingRequests, metrics.totalRequests)}%` }}
                                  />
                                </div>
                              </div>
                              <div className='token-track' aria-label={`${copy.totalTokens} ${metrics.totalTokens}`}>
                                <span style={{ width: `${percentage(metrics.totalTokens, maximumTokens)}%` }} />
                              </div>
                            </div>
                            <span className='trend-values'>
                              <strong>{exactCount(metrics.totalRequests, locale)}</strong>
                              <small>{tokenCount(metrics.totalTokens)} Token</small>
                            </span>
                          </button>
                          {selectedDayQuery?.from === bucketStart && dayDetailPanel}
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </article>

              <article className='panel distribution-panel'>
                <div className='panel-heading'>
                  <div>
                    <h2>{copy.distribution}</h2>
                    <p>{taskSourceReady ? copy.taskSourceReady : copy.taskSourcePending}</p>
                  </div>
                  <ChartHistogram size={22} />
                </div>

                {selectedUserIds.length > 0 && (
                  <p className='scope-note'>{copy.userEventDetail}: {selectedUserIds.join(', ')}</p>
                )}

                <div className='distribution-section'>
                  <h3>{copy.modelCallStatus}</h3>
                  <div className='taxonomy-grid'>
                    {(
                      [
                        [copy.accounted, projection.summary.accountedRequests, 'ACCOUNTED'],
                        [copy.rejected, projection.summary.rejectedRequests, 'REJECTED'],
                        [copy.pending, projection.summary.pendingRequests, 'PENDING'],
                        [copy.usageEvents, projection.summary.usageEvents, 'USAGE'],
                      ] as const
                    ).map(([label, value, contractType]) => (
                      <span key={contractType}>
                        {label}<small className='contract-type'>{contractType}</small>
                        <small>{usageSourceReady ? exactCount(value, locale) : '—'}</small>
                      </span>
                    ))}
                  </div>
                </div>

                <div className='distribution-section'>
                  <h3>{copy.taskStatus}</h3>
                  <div className='taxonomy-grid'>
                    {(
                      [
                        [copy.receivedTasks, taskSummary.summary.receivedTasks],
                        [copy.successfulTasks, taskSummary.summary.successfulTasks],
                        [copy.failedTasks, taskSummary.summary.failedTasks],
                        [copy.cancelledTasks, taskSummary.summary.cancelledTasks],
                      ] as const
                    ).map(([label, value]) => (
                      <span key={label}>
                        {label}
                        <small>{taskSourceReady ? exactCount(value, locale) : '—'}</small>
                      </span>
                    ))}
                  </div>
                </div>

                <div className='distribution-section'>
                  <h3>{copy.eventDistribution}</h3>
                  {taskSourceReady ? (
                    taskSummary.eventTypeCounts.map(({ type, eventCount }) => (
                      <DistributionRow
                        key={type}
                        label={`${eventTypeLabels[type]} · ${type}`}
                        value={eventCount}
                        maximum={maximumTaskEvents}
                        locale={locale}
                      />
                    ))
                  ) : (
                    <p className='source-empty'>{copy.taskScopeUnavailable}</p>
                  )}
                </div>

                <div className='distribution-section'>
                  <h3>{copy.taskDistribution}</h3>
                  {hasUnclassifiedTasks && <p className='source-empty'>{copy.unclassifiedScenarioNotice}</p>}
                  <div className='taxonomy-grid'>
                    {visibleScenarioCounts.map(({ scenario, taskCount }) => (
                      <span key={scenario}>
                        {scenarioLabels[scenario]}
                        <small>{taskSourceReady ? exactCount(taskCount, locale) : '—'}</small>
                      </span>
                    ))}
                  </div>
                  {visibleScenarioCounts.length === 0 && <p className='source-empty'>{copy.noData}</p>}
                </div>

                <div className='distribution-section'>
                  <h3>{copy.modelDistribution}</h3>
                  {models.map(({ modelId, callCount }) => (
                    <DistributionRow
                      key={modelId}
                      label={modelId}
                      value={callCount}
                      maximum={maximumModelCalls}
                      locale={locale}
                    />
                  ))}
                </div>
              </article>
            </section>

            <section className='panel details-panel' id='users'>
              <div className='panel-heading'>
                <div>
                  <h2>{copy.details}</h2>
                  <p>{copy.accuracyBoundary}</p>
                </div>
                <div className='details-toolbar'>
                  <label>
                    <span>{copy.visibleColumns}</span>
                    <Select
                      mode='multiple'
                      value={usageColumns}
                      maxTagCount={1}
                      onChange={(value) => {
                        const columns = value as UsageColumn[];
                        setUsageColumns(columns.length ? columns : ['user']);
                      }}
                    >
                      {usageColumnKeys.map((column) => (
                        <Select.Option key={column} value={column}>{usageColumnLabels[column]}</Select.Option>
                      ))}
                    </Select>
                  </label>
                  <UserBusiness size={22} />
                </div>
              </div>
              <div className='table-scroll'>
                <table>
                  <thead>
                    <tr>
                      {usageColumns.map((column) => (
                        <th key={column} title={column === 'events' ? copy.userEventScope : undefined}>
                          {usageColumnLabels[column]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((row) => (
                      <tr key={row.userId}>
                        {usageColumns.map((column) => (
                          <td key={column} title={column === 'events' ? copy.userEventScope : undefined}>
                            {renderUsageCell(column, row)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {userRows.length === 0 && <Empty description={copy.noData} />}
              </div>
            </section>

            <section className='panel audit-panel' id='audit'>
              <div className='panel-heading'>
                <div>
                  <h2>{copy.reconciliation}</h2>
                  <p>{copy.auditDescription}</p>
                </div>
                <Tag color={reconciliation.state === 'MATCHED' ? 'green' : 'orange'}>
                  {reconciliation.state === 'MATCHED' ? copy.matched : copy.mismatched}
                </Tag>
              </div>
              <dl className='check-list'>
                {(
                  [
                    [copy.requestStatuses, reconciliation.checks.requestStatuses],
                    [copy.usageTaskTotals, reconciliation.checks.usageTaskTotals],
                    [copy.completedInvocationUsage, reconciliation.checks.completedInvocationUsage],
                    [copy.usageInvocationLinks, reconciliation.checks.usageInvocationLinks],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className={value === '0' ? 'positive-value' : 'negative-value'}>
                      {exactCount(value, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className='validation-actions'>
                <span>
                  {copy.mismatchCount}: {exactCount(mismatchCount, locale)} · {copy.checkedAt}{' '}
                  {dateTime(reconciliation.checkedAt)}
                </span>
                <Button onClick={openEvents}>{copy.viewEvents}</Button>
              </div>
              {reconciliation.state === 'MISMATCHED' && (
                <Alert type='warning' content={copy.unmatchedWarning} showIcon />
              )}
            </section>
          </>
        )}
      </main>

      <Drawer
        width={760}
        title={copy.rawEvents}
        visible={eventsOpen}
        onCancel={() => setEventsOpen(false)}
        footer={null}
      >
        <p className='drawer-description'>{copy.rawEventsDescription}</p>
        {eventState.kind === 'error' && <Alert type='error' content={copy.loadFailed} showIcon />}
        {eventState.events.length === 0 && eventState.kind === 'loading' ? (
          <div className='drawer-loading'>
            <Spin dot />
          </div>
        ) : (
          <div className='event-list'>
            {eventState.events.map((event) => (
              <article className='event-row' key={`${event.kind}:${event.eventId}`}>
                <div className='event-kind'>
                  <Tag color={event.kind === 'USAGE' ? 'arcoblue' : 'gray'}>
                    {event.kind === 'USAGE' ? copy.usageEvent : copy.requestEvent}
                  </Tag>
                  <time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time>
                </div>
                <dl>
                  <div>
                    <dt>{copy.user}</dt>
                    <dd>{event.userId}</dd>
                  </div>
                  <div>
                    <dt>{copy.task}</dt>
                    <dd>{event.taskId}</dd>
                  </div>
                  <div>
                    <dt>{copy.model}</dt>
                    <dd>{event.modelId}</dd>
                  </div>
                  <div>
                    <dt>{copy.provider}</dt>
                    <dd>{event.providerId}</dd>
                  </div>
                  <div>
                    <dt>{event.kind === 'USAGE' ? copy.totalTokens : copy.outcome}</dt>
                    <dd>
                      {event.kind === 'USAGE' ? tokenCount(event.totalTokens) : event.outcome}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
        <div className='drawer-footer'>
          {eventState.kind === 'loading' && eventState.events.length > 0 ? (
            <Button loading>{copy.loadMore}</Button>
          ) : eventState.kind === 'ready' && eventState.nextCursor ? (
            <Button
              onClick={() => loadEventPage(eventState.nextCursor, eventState.events)}
            >
              {copy.loadMore}
            </Button>
          ) : eventState.events.length > 0 ? (
            copy.noMore
          ) : null}
        </div>
      </Drawer>
    </div>
  );
}
