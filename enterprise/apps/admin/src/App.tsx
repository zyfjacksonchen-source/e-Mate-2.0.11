import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Link,
  Modal,
  Select,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import { ChartLine, CheckOne, CloseOne, Plus, Refresh, UserBusiness } from '@icon-park/react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  AdminApiKeyMetadata,
  AdminApiKeyPrincipalType,
  AdminApiKeyScope,
  AdminModelRoute,
  AdminUserRole,
  AdminUserStatus,
  ConsentAcceptance,
  AdminConsentQuery,
  TenantUser,
} from '@e-mate/admin-contract';
import type { RuntimeRegistryModelStatus, RuntimeRegistryStatus } from '@e-mate/runtime-registry-contract';
import eMateLogo from '../../../../upstream/e-mate-2.0.5/desktop/src/v1/assets/emate-logo.png';
import {
  AdminApiError,
  ADMIN_MODEL_SESSION_KEY,
  ADMIN_TOKEN_SESSION_KEY,
  abbreviateAuditValue,
  createTenantUser,
  deleteTenantUser,
  formatTokenCount,
  issueApiKey,
  loadApiKeys,
  loadConsentAcceptances,
  loadModelRoutes,
  loadRuntimeStatus,
  loadTenantUsers,
  loginAdmin,
  publishModelRoute,
  quotaTokens,
  readAdminModelSession,
  resolveUsageDashboardPath,
  resetTenantUserPassword,
  revokeApiKey,
  testModelConnection,
  updateModelRoute,
  updateModelRouteKey,
  updateTenantUser,
  type QuotaUnit,
  type AdminModelSession,
} from './api';
import { messagesFor } from './i18n';

type ConsoleFacts = {
  status: RuntimeRegistryStatus;
  users: TenantUser[];
  keys: AdminApiKeyMetadata[];
  routes: AdminModelRoute[];
  consents: ConsentAcceptance[];
  consentedUserIds: string[];
};

type ConsoleState =
  | { kind: 'loading' }
  | { kind: 'ready'; facts: ConsoleFacts }
  | { kind: 'error'; status: number | null };

type CredentialPurpose = 'TASKS_ONLY' | 'MODELS_AND_TASKS';
type ModelTestState =
  | { kind: 'testing' }
  | { kind: 'passed'; checkedAt: string }
  | { kind: 'failed'; status: number | null };
function modelStatusLabel(status: RuntimeRegistryModelStatus, copy: ReturnType<typeof messagesFor>): string {
  if (status === 'HEALTHY') return copy.healthy;
  if (status === 'DEGRADED') return copy.degraded;
  return copy.unavailable;
}

function errorMessage(status: number | null, copy: ReturnType<typeof messagesFor>): string {
  if (status === 401) return copy.authFailed;
  if (status === 403) return copy.accessDenied;
  return copy.loadFailed;
}

function userStatusLabel(status: AdminUserStatus, copy: ReturnType<typeof messagesFor>): string {
  if (status === 'PENDING_APPROVAL') return copy.pendingApproval;
  if (status === 'ACTIVE') return copy.active;
  if (status === 'SUSPENDED') return copy.suspended;
  return copy.deleted;
}

function agreementExempt(roles: AdminUserRole[]): boolean {
  return roles.some((role) => role === 'TENANT_ADMIN' || role === 'AUDIT_ADMIN');
}

export function App() {
  const copy = messagesFor(navigator.language || 'zh-CN');
  const [token, setToken] = useState(() => sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY) ?? '');
  const [modelSession, setModelSession] = useState<AdminModelSession | null>(() =>
    readAdminModelSession(sessionStorage.getItem(ADMIN_MODEL_SESSION_KEY))
  );
  const [modelTests, setModelTests] = useState<Record<string, ModelTestState>>({});
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ConsoleState>({ kind: 'loading' });
  const [mutationError, setMutationError] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [userModal, setUserModal] = useState(false);
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<AdminUserRole[]>(['MEMBER']);
  const [initialPassword, setInitialPassword] = useState('');
  const [newTokenLimit, setNewTokenLimit] = useState<number>();
  const [newAllowedModelIds, setNewAllowedModelIds] = useState<string[]>([]);
  const [policyUsers, setPolicyUsers] = useState<TenantUser[]>([]);
  const [policyApprovePending, setPolicyApprovePending] = useState(false);
  const [quotaAmount, setQuotaAmount] = useState<number>();
  const [quotaUnit, setQuotaUnit] = useState<QuotaUnit>('K');
  const [quotaUnlimited, setQuotaUnlimited] = useState(false);
  const [policyModelIds, setPolicyModelIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [passwordUser, setPasswordUser] = useState<TenantUser | null>(null);
  const [replacementPassword, setReplacementPassword] = useState('');
  const [keyModal, setKeyModal] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [keyUserId, setKeyUserId] = useState('');
  const [credentialPurpose, setCredentialPurpose] = useState<CredentialPurpose>('TASKS_ONLY');
  const [principalType, setPrincipalType] = useState<AdminApiKeyPrincipalType>('DEVICE');
  const [principalId, setPrincipalId] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [routeKeyModal, setRouteKeyModal] = useState<AdminModelRoute | null>(null);
  const [routeApiKey, setRouteApiKey] = useState('');
  const [modelCatalogModal, setModelCatalogModal] = useState(false);
  const [modelToPublish, setModelToPublish] = useState('');
  const [consentUserFilter, setConsentUserFilter] = useState('');
  const [consentAgreementFilter, setConsentAgreementFilter] = useState('');
  const [consentDisclaimerFilter, setConsentDisclaimerFilter] = useState('');
  const [consentQuery, setConsentQuery] = useState<AdminConsentQuery>({ limit: 100 });
  const apiBase = import.meta.env.VITE_ADMIN_API_BASE as string | undefined;
  const authBase = import.meta.env.VITE_AUTH_API_BASE as string | undefined;
  const authClientId = (import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined) ?? 'e-mate-admin';
  const authOrganization = (import.meta.env.VITE_AUTH_ORGANIZATION as string | undefined) ?? 'emate-v2';
  const requestOptions = useMemo(() => ({ apiBase, origin: window.location.origin }), [apiBase]);
  const usagePath = useMemo(() => {
    try {
      return resolveUsageDashboardPath(
        import.meta.env.VITE_USAGE_DASHBOARD_PATH as string | undefined,
        window.location.origin
      );
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void Promise.all([
      loadRuntimeStatus(token, controller.signal, requestOptions),
      loadTenantUsers(token, controller.signal, requestOptions),
      loadApiKeys(token, controller.signal, requestOptions),
      loadModelRoutes(token, controller.signal, requestOptions),
      loadConsentAcceptances(token, controller.signal, requestOptions, consentQuery),
      loadConsentAcceptances(token, controller.signal, requestOptions, { limit: 200 }),
    ])
      .then(([status, users, keys, routes, consents, allConsents]) => {
        setTokenError(null);
        setState({
          kind: 'ready',
          facts: {
            status,
            users: users.users,
            keys: keys.keys,
            routes: routes.routes,
            consents: consents.acceptances,
            consentedUserIds: [...new Set(allConsents.acceptances.map((acceptance) => acceptance.userId))],
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const status = error instanceof AdminApiError ? error.status : null;
        if (status === 401) {
          sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
          sessionStorage.removeItem(ADMIN_MODEL_SESSION_KEY);
          setToken('');
          setModelSession(null);
          setTokenError(copy.authFailed);
        }
        setState({ kind: 'error', status });
      });
    return () => controller.abort();
  }, [consentQuery, copy.authFailed, reloadKey, requestOptions, token]);

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    if (!account.trim() || !password) {
      setTokenError(copy.tokenRequired);
      return;
    }
    const controller = new AbortController();
    setLoginBusy(true);
    setTokenError(null);
    void loginAdmin(
      {
        authBase,
        clientId: authClientId,
        organization: authOrganization,
        account: account.trim(),
        password,
      },
      controller.signal,
      requestOptions
    )
      .then((session) => {
        sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, session.accessToken);
        sessionStorage.setItem(ADMIN_MODEL_SESSION_KEY, JSON.stringify(session.modelGateway));
        setToken(session.accessToken);
        setModelSession(session.modelGateway);
        setPassword('');
      })
      .catch((error: unknown) => {
        setTokenError(error instanceof AdminApiError && error.status === 403 ? copy.accessDenied : copy.authFailed);
      })
      .finally(() => setLoginBusy(false));
  };

  const signOut = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_MODEL_SESSION_KEY);
    setToken('');
    setModelSession(null);
    setModelTests({});
    setPassword('');
    setState({ kind: 'loading' });
  };

  const mutate = async (action: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    setMutationError(false);
    setMutating(true);
    try {
      await action(controller.signal);
      setReloadKey((value) => value + 1);
    } catch {
      setMutationError(true);
      setReloadKey((value) => value + 1);
    } finally {
      setMutating(false);
    }
  };

  const runModelTest = (routeId: string) => {
    if (!modelSession) return;
    const controller = new AbortController();
    setModelTests((current) => ({ ...current, [routeId]: { kind: 'testing' } }));
    void testModelConnection(routeId, modelSession, controller.signal, {
      origin: window.location.origin,
    })
      .then(({ checkedAt }) => {
        setModelTests((current) => ({ ...current, [routeId]: { kind: 'passed', checkedAt } }));
      })
      .catch((error: unknown) => {
        const status = error instanceof AdminApiError ? error.status : null;
        if (status === 401) {
          sessionStorage.removeItem(ADMIN_MODEL_SESSION_KEY);
          setModelSession(null);
        }
        setModelTests((current) => ({ ...current, [routeId]: { kind: 'failed', status } }));
      });
  };

  if (!token) {
    return (
      <main className='auth-shell'>
        <section className='auth-card' aria-labelledby='auth-title'>
          <img className='brand-logo' src={eMateLogo} alt={copy.product} />
          <h1 id='auth-title'>{copy.tokenTitle}</h1>
          <p>{copy.tokenDescription}</p>
          <form onSubmit={submitToken}>
            <label htmlFor='admin-account'>{copy.account}</label>
            <Input id='admin-account' value={account} autoComplete='username' onChange={setAccount} />
            <label htmlFor='admin-password'>{copy.password}</label>
            <Input.Password id='admin-password' value={password} autoComplete='current-password' onChange={setPassword} />
            {tokenError && <Alert type='error' content={tokenError} showIcon />}
            <Button type='primary' htmlType='submit' long loading={loginBusy}>
              {copy.connect}
            </Button>
          </form>
        </section>
      </main>
    );
  }

  const facts = state.kind === 'ready' ? state.facts : null;
  const filteredUsers = facts
    ? facts.users.filter((user) => {
        const query = userSearch.trim().toLocaleLowerCase();
        return !query || `${user.displayName}\n${user.userId}`.toLocaleLowerCase().includes(query);
      })
    : [];
  const selectedUsers = facts?.users.filter((user) => selectedUserIds.includes(user.userId) && user.status !== 'DELETED') ?? [];
  const openPolicy = (users: TenantUser[], approvePending = false) => {
    if (users.length === 0) return;
    const current = users.length === 1 ? users[0] : undefined;
    const currentLimit = current?.tokenLimit;
    const nextUnit: QuotaUnit = currentLimit && currentLimit >= 1_000_000 && currentLimit % 1_000_000 === 0 ? 'M' : 'K';
    setQuotaUnit(nextUnit);
    setQuotaAmount(currentLimit === null || currentLimit === undefined ? undefined : currentLimit / (nextUnit === 'M' ? 1_000_000 : 1_000));
    setQuotaUnlimited(currentLimit === null);
    setPolicyModelIds(current?.allowedModelIds ?? []);
    setPolicyApprovePending(approvePending);
    setPolicyUsers(users);
  };
  const createUser = () =>
    void mutate(async (signal) => {
      await createTenantUser(token, signal, requestOptions, {
        schemaVersion: 1,
        userId: userId.trim(),
        displayName: displayName.trim(),
        roles,
        tokenLimit: newTokenLimit ?? null,
        allowedModelIds: newAllowedModelIds,
        initialPassword,
      });
      setUserModal(false);
      setUserId('');
      setDisplayName('');
      setRoles(['MEMBER']);
      setNewTokenLimit(undefined);
      setNewAllowedModelIds([]);
      setInitialPassword('');
    });
  const createKey = () =>
    void mutate(async (signal) => {
      const user = keyUserId;
      const scopes: AdminApiKeyScope[] =
        credentialPurpose === 'MODELS_AND_TASKS' ? ['task-events:write', 'models:invoke'] : ['task-events:write'];
      const keyPrincipalType = credentialPurpose === 'MODELS_AND_TASKS' ? 'USER' : principalType;
      const result = await issueApiKey(token, signal, requestOptions, {
        schemaVersion: 1,
        label: keyLabel.trim(),
        principalType: keyPrincipalType,
        principalId: keyPrincipalType === 'USER' ? user : principalId.trim(),
        userId: user,
        scopes,
      });
      setKeyModal(false);
      setKeyLabel('');
      setKeyUserId('');
      setCredentialPurpose('TASKS_ONLY');
      setPrincipalType('DEVICE');
      setPrincipalId('');
      setOneTimeSecret(result.secret);
    });

  return (
    <main className='admin-shell'>
      <aside>
        <img className='brand-logo' src={eMateLogo} alt={copy.product} />
        <div>
          <span>{copy.console}</span>
        </div>
        <Button type='text' className='sign-out' onClick={signOut}>
          {copy.signOut}
        </Button>
      </aside>
      <section className='admin-content' aria-labelledby='admin-title'>
        <header>
          <div>
            <p>{copy.console}</p>
            <h1 id='admin-title'>{copy.title}</h1>
            <span>{copy.subtitle}</span>
          </div>
          <Button
            icon={<Refresh />}
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={state.kind === 'loading'}
          >
            {copy.refresh}
          </Button>
        </header>

        <p className='scope-note'>{copy.source}</p>
        {mutationError && <Alert type='error' showIcon content={copy.mutationFailed} />}

        {state.kind === 'loading' && (
          <div className='loading-state' role='status' aria-live='polite'>
            <Spin size={26} />
          </div>
        )}
        {state.kind === 'error' && (
          <Alert
            type='error'
            showIcon
            content={errorMessage(state.status, copy)}
            action={
              <Button size='small' onClick={() => setReloadKey((value) => value + 1)}>
                {copy.retry}
              </Button>
            }
          />
        )}

        {facts && (
          <Tabs className='admin-tabs' defaultActiveTab='overview'>
            <Tabs.TabPane key='overview' title={copy.overview}>
              <section className='metric-grid' aria-label={copy.title}>
                <article>
                  <UserBusiness size={22} />
                  <span>{copy.activeUsers}</span>
                  <strong>{facts.status.activeUsers.toLocaleString()}</strong>
                </article>
                <article>
                  <ChartLine size={22} />
                  <span>{copy.activeSessions}</span>
                  <strong>{facts.status.activeSessions.toLocaleString()}</strong>
                </article>
                <article>
                  <CheckOne size={22} />
                  <span>{copy.runningTasks}</span>
                  <strong>{facts.status.runningTasks.toLocaleString()}</strong>
                </article>
                <article>
                  <CloseOne size={22} />
                  <span>{copy.failedTasks}</span>
                  <strong>{facts.status.failedTasks.toLocaleString()}</strong>
                </article>
              </section>
              <section className='fact-card' aria-labelledby='model-service-title'>
                <div>
                  <p>{copy.modelService}</p>
                  <h2 id='model-service-title'>{modelStatusLabel(facts.status.modelStatus, copy)}</h2>
                </div>
                <Tag
                  color={
                    facts.status.modelStatus === 'HEALTHY'
                      ? 'green'
                      : facts.status.modelStatus === 'DEGRADED'
                        ? 'orange'
                        : 'red'
                  }
                >
                  {facts.status.modelStatus}
                </Tag>
                <dl>
                  <div>
                    <dt>{copy.updatedAt}</dt>
                    <dd>
                      {new Intl.DateTimeFormat(navigator.language, {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      }).format(new Date(facts.status.updatedAt))}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className='usage-entry' aria-labelledby='usage-title'>
                <div>
                  <p>{copy.usageTitle}</p>
                  <h2 id='usage-title'>{copy.usageDescription}</h2>
                </div>
                {usagePath ? (
                  <Link href={usagePath} icon>
                    {copy.openUsage}
                  </Link>
                ) : (
                  <span>{copy.usageUnavailable}</span>
                )}
              </section>
            </Tabs.TabPane>

            <Tabs.TabPane key='users' title={copy.users}>
              <div className='section-heading'>
                <div>
                  <h2>{copy.users}</h2>
                  <p>{copy.usersDescription}</p>
                </div>
                <Button
                  type='primary'
                  icon={<Plus />}
                  onClick={() => {
                    setNewAllowedModelIds(
                      facts.routes.filter((route) => route.published && route.enabled).map((route) => route.routeId)
                    );
                    setUserModal(true);
                  }}
                >
                  {copy.addUser}
                </Button>
              </div>
              <div className='user-toolbar'>
                <Input.Search
                  value={userSearch}
                  placeholder={copy.searchUsers}
                  allowClear
                  onChange={setUserSearch}
                />
                <Checkbox
                  checked={
                    filteredUsers.some((user) => user.status !== 'DELETED') &&
                    filteredUsers.filter((user) => user.status !== 'DELETED').every((user) => selectedUserIds.includes(user.userId))
                  }
                  indeterminate={
                    filteredUsers.some((user) => selectedUserIds.includes(user.userId)) &&
                    !filteredUsers.filter((user) => user.status !== 'DELETED').every((user) => selectedUserIds.includes(user.userId))
                  }
                  onChange={(checked) => {
                    const visible = filteredUsers.filter((user) => user.status !== 'DELETED').map((user) => user.userId);
                    setSelectedUserIds((current) =>
                      checked ? [...new Set([...current, ...visible])] : current.filter((id) => !visible.includes(id))
                    );
                  }}
                >
                  {copy.selectAll}
                </Checkbox>
                <span>{copy.selectedUsers.replace('{count}', String(selectedUsers.length))}</span>
                <Button
                  type='primary'
                  disabled={!selectedUsers.some((user) => user.status === 'PENDING_APPROVAL')}
                  onClick={() => openPolicy(selectedUsers.filter((user) => user.status === 'PENDING_APPROVAL'), true)}
                >
                  {copy.batchApprove}
                </Button>
                <Button disabled={selectedUsers.length === 0} onClick={() => openPolicy(selectedUsers)}>
                  {copy.batchPolicy}
                </Button>
              </div>
              <div className='record-list'>
                {filteredUsers.map((user) => (
                  <article key={user.userId}>
                    {user.status !== 'DELETED' && (
                      <Checkbox
                        aria-label={`${copy.selectUser} ${user.displayName}`}
                        checked={selectedUserIds.includes(user.userId)}
                        onChange={(checked) =>
                          setSelectedUserIds((current) =>
                            checked ? [...new Set([...current, user.userId])] : current.filter((id) => id !== user.userId)
                          )
                        }
                      />
                    )}
                    <div>
                      <strong>{user.displayName}</strong>
                      <span>{user.userId}</span>
                    </div>
                    <div className='record-actions'>
                      {user.roles.map((role) => (
                        <Tag key={role}>{role}</Tag>
                      ))}
                      <Tag>
                        {copy.tokenLimit}：
                        {user.tokenLimit === null ? copy.tokenUnlimited : formatTokenCount(user.tokenLimit)}
                      </Tag>
                      <Tag>{copy.allowedModels}：{user.allowedModelIds.length}</Tag>
                      <Tag color={agreementExempt(user.roles) || facts.consentedUserIds.includes(user.userId) ? 'green' : 'gray'}>
                        {agreementExempt(user.roles)
                          ? copy.consentExempt
                          : facts.consentedUserIds.includes(user.userId) ? copy.consentSigned : copy.consentUnsigned}
                      </Tag>
                      <Tag color={user.status === 'ACTIVE' ? 'green' : 'gray'}>
                        {userStatusLabel(user.status, copy)}
                      </Tag>
                      {user.status !== 'DELETED' && (
                        <>
                          <Button
                            size='small'
                            loading={mutating}
                            onClick={() => {
                              openPolicy([user]);
                            }}
                          >
                            {copy.updateTokenLimit}
                          </Button>
                          <Button size='small' loading={mutating} onClick={() => setPasswordUser(user)}>
                            {copy.resetPassword}
                          </Button>
                          <Button
                            size='small'
                            loading={mutating}
                            onClick={() => {
                              if (user.status === 'PENDING_APPROVAL') {
                                openPolicy([user], true);
                                return;
                              }
                              void mutate(async (signal) => {
                                await updateTenantUser(token, signal, requestOptions, user.userId, {
                                  schemaVersion: 1,
                                  displayName: user.displayName,
                                  roles: user.roles,
                                  status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                                  tokenLimit: user.tokenLimit,
                                  allowedModelIds: user.allowedModelIds,
                                  expectedUpdatedAt: user.updatedAt,
                                });
                              });
                            }}
                          >
                            {user.status === 'ACTIVE' ? copy.suspend : user.status === 'PENDING_APPROVAL' ? copy.updateTokenLimit : copy.activate}
                          </Button>
                          <Button
                            size='small'
                            status='danger'
                            loading={mutating}
                            onClick={() =>
                              Modal.confirm({
                                title: copy.deleteUserTitle,
                                content: copy.deleteUserConfirm,
                                okText: copy.confirmDelete,
                                cancelText: copy.cancel,
                                okButtonProps: { status: 'danger' },
                                onOk: () =>
                                  mutate(async (signal) => {
                                    await deleteTenantUser(token, signal, requestOptions, user.userId, {
                                      schemaVersion: 1,
                                      expectedUpdatedAt: user.updatedAt,
                                    });
                                  }),
                              })
                            }
                          >
                            {copy.deleteUser}
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {filteredUsers.length === 0 && <p className='empty-state'>{copy.noUsers}</p>}
              </div>
            </Tabs.TabPane>

            <Tabs.TabPane key='keys' title={copy.credentials}>
              <div className='section-heading'>
                <div>
                  <h2>{copy.credentials}</h2>
                  <p>{copy.credentialsDescription}</p>
                </div>
                <Button
                  type='primary'
                  icon={<Plus />}
                  onClick={() => setKeyModal(true)}
                  disabled={!facts.users.some((user) => user.status === 'ACTIVE')}
                >
                  {copy.issueKey}
                </Button>
              </div>
              <div className='record-list'>
                {facts.keys.map((item) => (
                  <article key={item.keyId}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>
                        {item.principalType} · {item.principalId} · {item.userId}
                      </span>
                    </div>
                    <div className='record-actions'>
                      <Tag>{item.scopes.includes('models:invoke') ? copy.modelsAndTasks : copy.tasksOnly}</Tag>
                      <Tag color={item.revokedAt ? 'gray' : 'green'}>{item.revokedAt ? copy.revoked : copy.active}</Tag>
                      {!item.revokedAt && (
                        <Button
                          size='small'
                          status='danger'
                          loading={mutating}
                          onClick={() =>
                            void mutate(async (signal) => {
                              await revokeApiKey(token, signal, requestOptions, item.keyId);
                            })
                          }
                        >
                          {copy.revoke}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
                {facts.keys.length === 0 && <p className='empty-state'>{copy.noKeys}</p>}
              </div>
            </Tabs.TabPane>

            <Tabs.TabPane key='models' title={copy.models}>
              <div className='section-heading'>
                <div>
                  <h2>{copy.models}</h2>
                  <p>{copy.modelsDescription}</p>
                </div>
                <Button
                  type='primary'
                  icon={<Plus />}
                  disabled={!facts.routes.some((route) => !route.published)}
                  onClick={() => setModelCatalogModal(true)}
                >
                  {copy.addModel}
                </Button>
              </div>
              <Alert type='info' showIcon content={`${copy.modelsCatalogNotice} ${copy.modelTestUsageNotice}`} />
              <div className='record-list'>
                {facts.routes.filter((route) => route.published).map((route) => {
                  const modelTest = modelTests[route.routeId];
                  return <article key={route.routeId}>
                    <div>
                      <strong>{route.label}</strong>
                      <span>
                        {route.provider} · {route.routeId}
                      </span>
                    </div>
                    <div className='record-actions'>
                      {modelTest?.kind === 'passed' && (
                        <Tag color='green'>{copy.modelTestPassed}</Tag>
                      )}
                      {modelTest?.kind === 'failed' && (
                        <Tag color='red'>
                          {modelTest.status === 401 ? copy.modelTestExpired : copy.modelTestFailed}
                        </Tag>
                      )}
                      <Tag color={route.keyConfigured ? 'green' : 'gray'}>
                        {route.keyConfigured ? copy.customKeyConfigured : copy.deploymentKey}
                      </Tag>
                      <Button
                        size='small'
                        loading={modelTest?.kind === 'testing'}
                        disabled={
                          !route.enabled ||
                          !modelSession ||
                          !modelSession.allowedModelIds.includes(route.routeId)
                        }
                        onClick={() => runModelTest(route.routeId)}
                      >
                        {copy.testModelConnection}
                      </Button>
                      <Button
                        size='small'
                        loading={mutating}
                        onClick={() => {
                          setRouteApiKey('');
                          setRouteKeyModal(route);
                        }}
                      >
                        {copy.updateModelKey}
                      </Button>
                      <span>{route.enabled ? copy.enabled : copy.disabled}</span>
                      <Switch
                        checked={route.enabled}
                        loading={mutating}
                        onChange={(enabled) =>
                          void mutate(async (signal) => {
                            await updateModelRoute(token, signal, requestOptions, route.routeId, {
                              schemaVersion: 1,
                              enabled,
                            });
                          })
                        }
                      />
                      <Button
                        size='small'
                        status='danger'
                        loading={mutating}
                        onClick={() =>
                          Modal.confirm({
                            title: copy.removeModel,
                            content: copy.removeModelConfirm,
                            okText: copy.removeModel,
                            cancelText: copy.cancel,
                            okButtonProps: { status: 'danger' },
                            onOk: () =>
                              mutate(async (signal) => {
                                await publishModelRoute(token, signal, requestOptions, route.routeId, {
                                  schemaVersion: 1,
                                  published: false,
                                });
                              }),
                          })
                        }
                      >
                        {copy.removeModel}
                      </Button>
                    </div>
                  </article>;
                })}
                {!facts.routes.some((route) => route.published) && <p className='empty-state'>{copy.noModels}</p>}
              </div>
            </Tabs.TabPane>

            <Tabs.TabPane key='consents' title={copy.consents}>
              <div className='section-heading'>
                <div>
                  <h2>{copy.consents}</h2>
                  <p>{copy.consentsDescription}</p>
                </div>
              </div>
              <div className='consent-filters' role='search' aria-label={copy.consents}>
                <Input
                  value={consentUserFilter}
                  placeholder={copy.consentUserFilter}
                  onChange={setConsentUserFilter}
                  allowClear
                />
                <Input
                  value={consentAgreementFilter}
                  placeholder={copy.consentAgreementVersion}
                  onChange={setConsentAgreementFilter}
                  allowClear
                />
                <Input
                  value={consentDisclaimerFilter}
                  placeholder={copy.consentDisclaimerVersion}
                  onChange={setConsentDisclaimerFilter}
                  allowClear
                />
                <Button
                  type='primary'
                  onClick={() =>
                    setConsentQuery({
                      ...(consentUserFilter.trim() ? { userId: consentUserFilter.trim() } : {}),
                      ...(consentAgreementFilter.trim() ? { agreementVersion: consentAgreementFilter.trim() } : {}),
                      ...(consentDisclaimerFilter.trim() ? { disclaimerVersion: consentDisclaimerFilter.trim() } : {}),
                      limit: 100,
                    })
                  }
                >
                  {copy.applyFilters}
                </Button>
                <Button
                  onClick={() => {
                    setConsentUserFilter('');
                    setConsentAgreementFilter('');
                    setConsentDisclaimerFilter('');
                    setConsentQuery({ limit: 100 });
                  }}
                >
                  {copy.clearFilters}
                </Button>
              </div>
              <div className='record-list'>
                {facts.consents.map((consent) => (
                  <article key={consent.acceptanceId}>
                    <div>
                      <strong>{consent.userId}</strong>
                      <span>
                        {copy.consentAcceptedAt}:{' '}
                        {new Intl.DateTimeFormat(navigator.language, {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        }).format(new Date(consent.acceptedAt))}
                      </span>
                    </div>
                    <div className='record-actions'>
                      {[
                        [copy.consentAcceptanceId, consent.acceptanceId],
                        [copy.consentAgreementId, consent.agreementId],
                        [copy.consentContentHash, consent.contentHash],
                      ].map(([label, value]) => (
                        <Tooltip key={label} content={`${label}: ${value}`} trigger={['hover', 'focus']}>
                          <Tag tabIndex={0} aria-label={`${label}: ${value}`}>
                            {label} · {abbreviateAuditValue(value)}
                          </Tag>
                        </Tooltip>
                      ))}
                      <Tag>
                        {copy.consentAgreementVersion} · {consent.agreementVersion}
                      </Tag>
                      <Tag>
                        {copy.consentDisclaimerVersion} · {consent.disclaimerVersion}
                      </Tag>
                      <Tag>
                        {copy.consentClientVersion} · {consent.clientVersion}
                      </Tag>
                      <Tag>
                        {copy.consentLocale} · {consent.locale}
                      </Tag>
                    </div>
                  </article>
                ))}
                {facts.consents.length === 0 && <p className='empty-state'>{copy.noConsents}</p>}
              </div>
            </Tabs.TabPane>
          </Tabs>
        )}
      </section>

      <Modal
        title={copy.addUser}
        visible={userModal}
        onCancel={() => {
          setUserModal(false);
          setInitialPassword('');
        }}
        onOk={createUser}
        okButtonProps={{
          loading: mutating,
          disabled:
            !userId.trim() ||
            !displayName.trim() ||
            roles.length === 0 ||
            newAllowedModelIds.length === 0 ||
            initialPassword.length < 12 ||
            /\p{Cc}/u.test(initialPassword),
        }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <label htmlFor='new-user-id'>{copy.userId}</label>
          <Input id='new-user-id' value={userId} onChange={setUserId} />
          <label htmlFor='new-display-name'>{copy.displayName}</label>
          <Input id='new-display-name' value={displayName} onChange={setDisplayName} />
          <label htmlFor='new-user-password'>{copy.initialPassword}</label>
          <Input.Password
            id='new-user-password'
            value={initialPassword}
            onChange={setInitialPassword}
            autoComplete='new-password'
            visibilityToggle
          />
          <span className='field-hint'>{copy.passwordPolicy}</span>
          <label>{copy.roles}</label>
          <Select
            mode='multiple'
            value={roles}
            onChange={(value) => setRoles(value as AdminUserRole[])}
            options={[
              { label: 'MEMBER', value: 'MEMBER' },
              { label: 'AUDIT_ADMIN', value: 'AUDIT_ADMIN' },
              { label: 'TENANT_ADMIN', value: 'TENANT_ADMIN' },
            ]}
          />
          <label htmlFor='new-token-limit'>{copy.tokenLimit}</label>
          <InputNumber
            id='new-token-limit'
            value={newTokenLimit}
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            precision={0}
            placeholder={copy.tokenLimitOptional}
            onChange={setNewTokenLimit}
            style={{ width: '100%' }}
          />
          <label>{copy.allowedModels}</label>
          <Select
            mode='multiple'
            value={newAllowedModelIds}
            onChange={(value) => setNewAllowedModelIds(value as string[])}
            options={(facts?.routes ?? []).filter((route) => route.published && route.enabled).map((route) => ({
              label: route.label,
              value: route.routeId,
            }))}
          />
          {newAllowedModelIds.length === 0 && <span className='field-hint'>{copy.activeUserModelRequired}</span>}
        </div>
      </Modal>

      <Modal
        title={copy.resetPassword}
        visible={passwordUser !== null}
        onCancel={() => {
          setPasswordUser(null);
          setReplacementPassword('');
        }}
        onOk={() =>
          void mutate(async (signal) => {
            const currentUser = passwordUser;
            if (!currentUser || currentUser.status === 'DELETED') return;
            const password = replacementPassword;
            setPasswordUser(null);
            setReplacementPassword('');
            await resetTenantUserPassword(token, signal, requestOptions, currentUser.userId, {
              schemaVersion: 1,
              password,
            });
          })
        }
        okButtonProps={{
          loading: mutating,
          disabled: replacementPassword.length < 12 || /\p{Cc}/u.test(replacementPassword),
        }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <Alert type='warning' showIcon content={copy.resetPasswordNotice} />
          <label htmlFor='replacement-password'>{copy.replacementPassword}</label>
          <Input.Password
            id='replacement-password'
            value={replacementPassword}
            onChange={setReplacementPassword}
            autoComplete='new-password'
            visibilityToggle
          />
          <span className='field-hint'>{copy.passwordPolicy}</span>
        </div>
      </Modal>

      <Modal
        title={policyApprovePending ? copy.batchApprove : copy.updateTokenLimit}
        visible={policyUsers.length > 0}
        onCancel={() => {
          setPolicyUsers([]);
          setQuotaAmount(undefined);
          setPolicyModelIds([]);
          setPolicyApprovePending(false);
        }}
        onOk={() =>
          void mutate(async (signal) => {
            const users = policyUsers.filter(
              (user): user is TenantUser & { status: Exclude<AdminUserStatus, 'DELETED'> } =>
                user.status !== 'DELETED'
            );
            const nextTokenLimit = quotaTokens(quotaAmount, quotaUnit, quotaUnlimited);
            if (nextTokenLimit === undefined) return;
            await Promise.all(
              users.map((currentUser) =>
                updateTenantUser(token, signal, requestOptions, currentUser.userId, {
                  schemaVersion: 1,
                  displayName: currentUser.displayName,
                  roles: currentUser.roles,
                  status:
                    policyApprovePending && currentUser.status === 'PENDING_APPROVAL'
                      ? 'ACTIVE'
                      : currentUser.status,
                  tokenLimit: nextTokenLimit,
                  allowedModelIds: policyModelIds,
                  expectedUpdatedAt: currentUser.updatedAt,
                })
              )
            );
            setSelectedUserIds((current) => current.filter((id) => !users.some((user) => user.userId === id)));
            setPolicyUsers([]);
            setQuotaAmount(undefined);
            setPolicyModelIds([]);
            setPolicyApprovePending(false);
          })
        }
        okText={policyApprovePending ? copy.confirmApprove : copy.savePolicy}
        okButtonProps={{
          loading: mutating,
          disabled: quotaTokens(quotaAmount, quotaUnit, quotaUnlimited) === undefined || policyModelIds.length === 0,
        }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <Alert
            type='info'
            showIcon
            content={copy.policyUsers.replace('{count}', String(policyUsers.length))}
          />
          <label>{copy.tokenLimit}</label>
          <div className='quota-row'>
            <InputNumber
              value={quotaAmount}
              min={0.001}
              max={Number.MAX_SAFE_INTEGER / (quotaUnit === 'M' ? 1_000_000 : 1_000)}
              precision={3}
              placeholder={copy.tokenLimitOptional}
              disabled={quotaUnlimited}
              onChange={setQuotaAmount}
              style={{ width: '100%' }}
            />
            <Select
              value={quotaUnit}
              disabled={quotaUnlimited}
              onChange={(value) => setQuotaUnit(value as QuotaUnit)}
              options={[{ label: 'K', value: 'K' }, { label: 'M', value: 'M' }]}
            />
            <Checkbox checked={quotaUnlimited} onChange={setQuotaUnlimited}>
              {copy.tokenUnlimited}
            </Checkbox>
          </div>
          <label>{copy.allowedModels}</label>
          <Select
            mode='multiple'
            value={policyModelIds}
            onChange={(value) => setPolicyModelIds(value as string[])}
            options={(facts?.routes ?? []).filter((route) => route.published && route.enabled).map((route) => ({
              label: route.label,
              value: route.routeId,
            }))}
          />
        </div>
      </Modal>

      <Modal
        title={copy.addModel}
        visible={modelCatalogModal}
        onCancel={() => {
          setModelCatalogModal(false);
          setModelToPublish('');
        }}
        onOk={() =>
          void mutate(async (signal) => {
            if (!modelToPublish) return;
            await publishModelRoute(token, signal, requestOptions, modelToPublish, {
              schemaVersion: 1,
              published: true,
            });
            setModelCatalogModal(false);
            setModelToPublish('');
          })
        }
        okButtonProps={{ loading: mutating, disabled: !modelToPublish }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <Alert type='info' showIcon content={copy.modelsCatalogNotice} />
          <label>{copy.modelCatalog}</label>
          <Select
            value={modelToPublish}
            onChange={setModelToPublish}
            options={(facts?.routes ?? [])
              .filter((route) => !route.published)
              .map((route) => ({ label: `${route.label} · ${route.provider}`, value: route.routeId }))}
          />
        </div>
      </Modal>

      <Modal
        title={copy.updateModelKey}
        visible={routeKeyModal !== null}
        onCancel={() => {
          setRouteKeyModal(null);
          setRouteApiKey('');
        }}
        onOk={() =>
          void mutate(async (signal) => {
            if (!routeKeyModal) return;
            await updateModelRouteKey(token, signal, requestOptions, routeKeyModal.routeId, {
              schemaVersion: 1,
              apiKey: routeApiKey,
            });
            setRouteKeyModal(null);
            setRouteApiKey('');
          })
        }
        okButtonProps={{ loading: mutating, disabled: routeApiKey.length < 20 || /\s/.test(routeApiKey) }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <Alert type='info' showIcon content={copy.modelKeyNotice} />
          <label htmlFor='model-route-key'>{copy.modelKeyLabel}</label>
          <Input.Password
            id='model-route-key'
            value={routeApiKey}
            onChange={setRouteApiKey}
            autoComplete='new-password'
            visibilityToggle
          />
        </div>
      </Modal>

      <Modal
        title={copy.issueKey}
        visible={keyModal}
        onCancel={() => {
          setKeyModal(false);
          setCredentialPurpose('TASKS_ONLY');
        }}
        onOk={createKey}
        okButtonProps={{
          loading: mutating,
          disabled:
            !keyLabel.trim() ||
            !keyUserId ||
            (credentialPurpose === 'TASKS_ONLY' && principalType === 'DEVICE' && !principalId.trim()),
        }}
        unmountOnExit
      >
        <div className='modal-fields'>
          <label htmlFor='key-label'>{copy.keyLabel}</label>
          <Input id='key-label' value={keyLabel} onChange={setKeyLabel} />
          <label>{copy.boundUser}</label>
          <Select
            value={keyUserId}
            onChange={setKeyUserId}
            options={facts?.users
              .filter((user) => user.status === 'ACTIVE')
              .map((user) => ({ label: `${user.displayName} · ${user.userId}`, value: user.userId }))}
          />
          <label>{copy.credentialUse}</label>
          <Select
            value={credentialPurpose}
            onChange={(value) => {
              const purpose = value as CredentialPurpose;
              setCredentialPurpose(purpose);
              if (purpose === 'MODELS_AND_TASKS') {
                setPrincipalType('USER');
                setPrincipalId('');
              }
            }}
            options={[
              { label: copy.tasksOnly, value: 'TASKS_ONLY' },
              { label: copy.modelsAndTasks, value: 'MODELS_AND_TASKS' },
            ]}
          />
          {credentialPurpose === 'TASKS_ONLY' && (
            <>
              <label>{copy.principalType}</label>
              <Select
                value={principalType}
                onChange={(value) => setPrincipalType(value as AdminApiKeyPrincipalType)}
                options={[
                  { label: copy.device, value: 'DEVICE' },
                  { label: copy.user, value: 'USER' },
                ]}
              />
              {principalType === 'DEVICE' && (
                <>
                  <label htmlFor='principal-id'>{copy.deviceId}</label>
                  <Input id='principal-id' value={principalId} onChange={setPrincipalId} />
                </>
              )}
            </>
          )}
          <Alert
            type='info'
            showIcon
            content={credentialPurpose === 'MODELS_AND_TASKS' ? copy.modelsAndTasksNotice : copy.tasksOnlyNotice}
          />
        </div>
      </Modal>

      <Modal
        title={copy.secretTitle}
        visible={oneTimeSecret !== null}
        footer={
          <Button
            type='primary'
            onClick={() => {
              setOneTimeSecret(null);
            }}
          >
            {copy.secretSaved}
          </Button>
        }
        onCancel={() => setOneTimeSecret(null)}
        unmountOnExit
      >
        <Alert type='warning' showIcon content={copy.secretNotice} />
        <Input.TextArea className='secret-field' value={oneTimeSecret ?? ''} readOnly autoSize />
      </Modal>
    </main>
  );
}
