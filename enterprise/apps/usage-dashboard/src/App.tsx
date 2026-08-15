import { Alert, Button, Empty, Input, Link, Select, Spin, Tag } from '@arco-design/web-react';
import { ChartHistogram, ChartLine, Home, Key, Refresh } from '@icon-park/react';
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import type { TaskEventType, TaskScenario } from '@e-mate/monitoring-contract';
import eMateLogo from '../../../../upstream/e-mate-2.0.5/desktop/src/v1/assets/emate-logo.png';
import { loadUsageDashboard, queryForPeriod, UsageApiError, type UsageDashboardData } from './api';
import { messagesFor } from './i18n';
import { callSuccessRate, exactCount, hasUsageFacts, percentage, usageModels, usageTrend } from './usage-data';

const TOKEN_SESSION_KEY = 'e-mate.usage.read-token';
const periodOptions = [7, 30, 90] as const;

type DashboardState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: UsageDashboardData }
  | { kind: 'error'; status: number | null };

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
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<(typeof periodOptions)[number]>(7);
  const [reloadKey, setReloadKey] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardState>({ kind: 'loading' });

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const query = queryForPeriod(periodDays);
    setDashboard({ kind: 'loading' });
    void loadUsageDashboard(token, query, controller.signal)
      .then((data) => {
        setTokenError(null);
        setDashboard({ kind: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const status = error instanceof UsageApiError ? error.status : null;
        if (status === 401) {
          sessionStorage.removeItem(TOKEN_SESSION_KEY);
          setToken('');
          setTokenError(copy.authFailed);
        }
        setDashboard({ kind: 'error', status });
      });
    return () => controller.abort();
  }, [copy.authFailed, periodDays, reloadKey, token]);

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setTokenError(copy.tokenRequired);
      return;
    }
    sessionStorage.setItem(TOKEN_SESSION_KEY, nextToken);
    setTokenError(null);
    setToken(nextToken);
    setTokenInput('');
  };

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    setToken('');
  };

  if (!token) {
    return (
      <main className='auth-shell'>
        <section className='auth-card' aria-labelledby='auth-title'>
          <div className='auth-brand'>
            <img src={eMateLogo} alt={copy.product} />
          </div>
          <div className='auth-icon' aria-hidden='true'>
            <Key size={28} />
          </div>
          <h1 id='auth-title'>{copy.tokenTitle}</h1>
          <p>{copy.tokenDescription}</p>
          <form onSubmit={submitToken}>
            <label htmlFor='usage-token'>{copy.tokenLabel}</label>
            <Input.Password
              id='usage-token'
              value={tokenInput}
              autoComplete='off'
              placeholder={copy.tokenPlaceholder}
              onChange={setTokenInput}
              visibilityToggle
            />
            {tokenError && <Alert type='error' content={tokenError} showIcon />}
            <Button type='primary' htmlType='submit' long>
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
  const maximumRequests = maxCount(trends.map(({ metrics }) => metrics.totalRequests));
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
  const scenarioLabels: Record<TaskScenario, string> = {
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

  return (
    <div className='dashboard-shell'>
      <aside className='sidebar'>
        <div className='sidebar-brand'>
          <img src={eMateLogo} alt={copy.product} />
        </div>
        <nav aria-label={copy.overview}>
          <Link className='is-active' href='#overview' aria-current='page'>
            <Home size={20} />
            {copy.overview}
          </Link>
          <Link href='#trend'>
            <ChartHistogram size={20} />
            {copy.usage}
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
            <label>
              <span>{copy.period}</span>
              <Select
                value={periodDays}
                onChange={(value) => setPeriodDays(value as (typeof periodOptions)[number])}
                aria-label={copy.period}
              >
                <Select.Option value={7}>{copy.last7Days}</Select.Option>
                <Select.Option value={30}>{copy.last30Days}</Select.Option>
                <Select.Option value={90}>{copy.last90Days}</Select.Option>
              </Select>
            </label>
            <Button
              icon={<Refresh />}
              onClick={() => setReloadKey((value) => value + 1)}
              loading={dashboard.kind === 'loading'}
            >
              {copy.refresh}
            </Button>
          </div>
        </header>

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
                label={copy.callSuccessRate}
                value={successRate === null ? '—' : `${successRate}%`}
                detail={
                  successRate === null
                    ? copy.noData
                    : `${exactCount(projection.summary.accountedRequests, locale)} ${copy.accounted} / ${exactCount(
                        completedCalls,
                        locale
                      )} ${copy.completedCalls}`
                }
                tone='positive'
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
                    </div>
                    {trends.map(({ bucketStart, metrics }) => {
                      const totalWidth = percentage(metrics.totalRequests, maximumRequests);
                      return (
                        <div className='trend-row' key={bucketStart}>
                          <time dateTime={bucketStart}>{day(bucketStart)}</time>
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
                                style={{
                                  width: `${percentage(metrics.accountedRequests, metrics.totalRequests)}%`,
                                }}
                              />
                              <span
                                className='trend-rejected'
                                style={{
                                  width: `${percentage(metrics.rejectedRequests, metrics.totalRequests)}%`,
                                }}
                              />
                              <span
                                className='trend-pending'
                                style={{
                                  width: `${percentage(metrics.pendingRequests, metrics.totalRequests)}%`,
                                }}
                              />
                            </div>
                          </div>
                          <strong>{exactCount(metrics.totalRequests, locale)}</strong>
                        </div>
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
                        label={eventTypeLabels[type]}
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
                  <div className='taxonomy-grid'>
                    {taskSummary.scenarioCounts.map(({ scenario, taskCount }) => (
                      <span key={scenario}>
                        {scenarioLabels[scenario]}
                        <small>{taskSourceReady ? exactCount(taskCount, locale) : '—'}</small>
                      </span>
                    ))}
                  </div>
                </div>

                <div className='distribution-section'>
                  <h3>{copy.modelDistribution}</h3>
                  {models.slice(0, 3).map(({ modelId, callCount }) => (
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
          </>
        )}
      </main>
    </div>
  );
}
