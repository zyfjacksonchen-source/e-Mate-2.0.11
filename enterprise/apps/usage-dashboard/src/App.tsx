import { Alert, Button, Drawer, Empty, Input, Link, Select, Spin, Tag } from '@arco-design/web-react';
import { ChartHistogram, ChartLine, CheckOne, Home, Refresh, UserBusiness } from '@icon-park/react';
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { TaskEventType, TaskScenario, TenantUsageEvent } from '@e-mate/monitoring-contract';
import eMateLogo from '../../../../upstream/e-mate-2.0.5/desktop/src/v1/assets/emate-logo.png';
import {
  loadUsageDashboard,
  loadUsageEvents,
  loginUsageAccount,
  logoutUsageAccount,
  queryForDay,
  queryForPeriod,
  queryForRange,
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
  usageUsers,
} from './usage-data';

const TOKEN_SESSION_KEY = 'e-mate.usage.access-token';
const REFRESH_TOKEN_SESSION_KEY = 'e-mate.usage.refresh-token';
const periodOptions = [7, 30, 90] as const;

function localDateTime(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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
  const [period, setPeriod] = useState<(typeof periodOptions)[number] | 'custom'>(7);
  const [range, setRange] = useState<UsageQuery>(() => queryForPeriod(7));
  const [customFrom, setCustomFrom] = useState(() => localDateTime(new Date(Date.now() - 7 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => localDateTime(new Date()));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [knownUsers, setKnownUsers] = useState<Array<{ userId: string; displayName: string }>>([]);
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

  const selectPeriod = (value: (typeof periodOptions)[number] | 'custom') => {
    setPeriod(value);
    setRangeError(null);
    resetEvents();
    resetDayDetail();
    if (value !== 'custom') setRange(queryForPeriod(value));
  };

  const applyCustomRange = () => {
    const fromValue = customFromInput.current?.value ?? customFrom;
    const toValue = customToInput.current?.value ?? customTo;
    try {
      setRange(queryForRange(new Date(fromValue), new Date(toValue)));
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
  const models = projection ? usageModels(projection) : [];
  const userUsage = projection ? usageUsers(projection) : [];
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
  const activeUsers = projection ? new Set(projection.groups.map(({ userId }) => userId)).size.toString() : '0';
  const dayData = dayDetail.kind === 'ready' ? dayDetail.data : null;
  const dayTaskSummary = dayData?.taskSummary;
  const dayUsageRows = dayData ? usageDetails(dayData.projection) : [];
  const visibleScenarioCounts = taskSummary?.scenarioCounts.filter(({ taskCount }) => taskCount !== '0') ?? [];
  const dayVisibleScenarioCounts = dayTaskSummary?.scenarioCounts.filter(({ taskCount }) => taskCount !== '0') ?? [];
  const hasUnclassifiedTasks = visibleScenarioCounts.some(({ scenario }) => scenario === 'GENERAL');
  const dayHasUnclassifiedTasks = dayVisibleScenarioCounts.some(({ scenario }) => scenario === 'GENERAL');
  const scenarioLabels: Record<TaskScenario, string> = {
    GENERAL: copy.taxonomyGeneral,
    CONTENT_CREATION: copy.taxonomyCreative,
    DOCUMENT_EDITING: copy.taxonomyDocument,
    SYSTEM_MAINTENANCE: copy.taxonomySystem,
    ASSET_PRODUCTION: copy.taxonomyMaterial,
    DATA_PROCESSING: copy.taxonomyData,
    SEARCH_QUERY: copy.taxonomySearch,
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
  const eventQuery = projection
    ? (selectedDayQuery ?? {
        from: projection.from,
        to: projection.to,
        timezone: projection.timezone,
        bucket: projection.bucket,
        ...(selectedUserIds.length ? { userIds: selectedUserIds } : {}),
      } satisfies UsageQuery)
    : null;
  const toggleDayDetail = (bucketStart: string) => {
    resetEvents();
    if (selectedDayQuery?.from === bucketStart) {
      resetDayDetail();
      return;
    }
    if (!projection) return;
    setSelectedDayQuery(queryForDay(bucketStart, projection.to, projection.timezone, selectedUserIds));
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
                if (period !== 'custom') setRange(queryForPeriod(period));
                else setReloadKey((value) => value + 1);
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
                  type='datetime-local'
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.to}</span>
                <input
                  ref={customToInput}
                  type='datetime-local'
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
                value={usageSourceReady ? exactCount(activeUsers, locale) : '—'}
                detail={
                  usageSourceReady
                    ? `${exactCount(models.length.toString(), locale)} ${copy.modelDistribution}`
                    : copy.noData
                }
              />
            </section>

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
                  <ChartLine size={22} />
                </div>
                {trends.length === 0 ? (
                  <Empty description={copy.noData} />
                ) : (
                  <div className='trend-list'>
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
                        <button
                          type='button'
                          className={`trend-row${selectedDayQuery?.from === bucketStart ? ' is-selected' : ''}`}
                          key={bucketStart}
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
                      );
                    })}
                    {selectedDayQuery && (
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
                                      <td>{row.userId}</td><td>{row.modelId}</td>
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
                    )}
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
                <UserBusiness size={22} />
              </div>
              <div className='table-scroll'>
                <table>
                  <thead>
                    <tr>
                      <th>{copy.user}</th>
                      <th>{copy.model}</th>
                      <th>{copy.userStatus}</th>
                      <th title={copy.userEventScope}>{copy.userEventCount}</th>
                      <th>{copy.requests}</th>
                      <th>{copy.inputTokens}</th>
                      <th>{copy.outputTokens}</th>
                      <th>{copy.cacheTokens}</th>
                      <th>{copy.totalTokens}</th>
                      <th>{copy.configuredQuota}</th>
                      <th>{copy.cost}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((row) => {
                      const cacheTokens = (
                        BigInt(row.metrics.cacheReadTokens) + BigInt(row.metrics.cacheWriteTokens)
                      ).toString();
                      const quota = row.tokenLimit;
                      return (
                        <tr key={row.userId}>
                          <td>
                            <strong>{row.displayName}</strong>
                            <small className='table-subline'>{row.userId}</small>
                          </td>
                          <td>{row.modelIds.join(', ') || '—'}</td>
                          <td>{userStatusLabel(row.status)}</td>
                          <td title={copy.userEventScope}>{exactCount(row.eventCount, locale)}</td>
                          <td>{exactCount(row.metrics.totalRequests, locale)}</td>
                          <td>{tokenCount(row.metrics.inputTokens)}</td>
                          <td>{tokenCount(row.metrics.outputTokens)}</td>
                          <td>{tokenCount(cacheTokens)}</td>
                          <td>{tokenCount(row.metrics.totalTokens)}</td>
                          <td>
                            {quota === undefined ? (
                              copy.quotaUnavailable
                            ) : quota === null ? (
                              copy.unlimited
                            ) : (
                              <span className='quota-cell'>
                                {tokenCount(String(quota))}
                                <small>{copy.weeklyQuota}</small>
                              </span>
                            )}
                          </td>
                          <td>{exactCost(row.metrics.costUsd, locale)}</td>
                        </tr>
                      );
                    })}
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
