import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import css from './identity.module.css'

interface AgreementDocument {
  id: string
  title: string
  version: string
  markdown: string
  sha256: string
}

interface Acknowledgement {
  id: string
  label: string
}

interface AgreementBundle {
  ready: boolean
  blocker?: string
  provider_legal_name?: string
  bundle_sha256: string
  required_acknowledgements: string[]
  acknowledgements: Acknowledgement[]
  documents: AgreementDocument[]
}

export interface IdentityBootstrap {
  schema_version: 1
  ready: boolean
  authenticated: boolean
  workspace_unlocked: boolean
  blocker?: string
  display_name?: string
  account_status?: 'active'
  weekly_token_limit?: number
  agreement_receipt_id?: string
  agreements: AgreementBundle
}

interface RegistrationChallenge {
  schema_version: 1
  challenge_id: string
  image_data_url: string
  expires_at: string
}

interface RegistrationReceipt {
  schema_version: 1
  registration_id: string
  status: 'pending_approval'
}

export type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error?: { message?: string } }

interface Props {
  callIdentity: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
}

export function validBootstrap(value: unknown): value is IdentityBootstrap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<IdentityBootstrap>
  return state.schema_version === 1
    && typeof state.ready === 'boolean'
    && typeof state.authenticated === 'boolean'
    && typeof state.workspace_unlocked === 'boolean'
    && state.agreements !== null
    && typeof state.agreements === 'object'
    && typeof state.agreements.bundle_sha256 === 'string'
    && Array.isArray(state.agreements.required_acknowledgements)
    && Array.isArray(state.agreements.acknowledgements)
    && Array.isArray(state.agreements.documents)
    && (!state.authenticated
      || state.account_status === 'active'
        && Number.isSafeInteger(state.weekly_token_limit)
        && (state.weekly_token_limit ?? 0) > 0)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '企业身份服务暂不可用，请稍后重试。'
}

export function IdentityGate({ callIdentity }: Props) {
  const [state, setState] = useState<IdentityBootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [rememberLogin, setRememberLogin] = useState(false)
  const [authView, setAuthView] = useState<'login' | 'register'>(() => location.pathname === '/register' ? 'register' : 'login')
  const [account, setAccount] = useState('')
  const [realName, setRealName] = useState('')
  const [registrationPassword, setRegistrationPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null)
  const [challengeBusy, setChallengeBusy] = useState(false)
  const [registration, setRegistration] = useState<RegistrationReceipt | null>(null)
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set())
  const [returnPath] = useState(() => ['/login', '/register', '/agreement'].includes(location.pathname)
    ? '/'
    : `${location.pathname}${location.search}${location.hash}`)

  const load = async () => {
    setError(null)
    try {
      const result = await callIdentity('identity.bootstrap', {})
      if (!result.ok) throw new Error(result.error?.message ?? '企业身份服务拒绝了请求。')
      if (!validBootstrap(result.value)) throw new Error('企业身份服务返回了无效状态。')
      setState(result.value)
    } catch (loadError) {
      setError(errorMessage(loadError))
    }
  }

  useEffect(() => { void load() }, [])

  const mode = state?.ready !== true || !state.authenticated
    ? 'login'
    : state.workspace_unlocked
      ? 'unlocked'
      : 'agreement'

  useEffect(() => {
    if (mode === 'unlocked') {
      if (['/login', '/register', '/agreement'].includes(location.pathname)) {
        history.replaceState(null, '', returnPath)
        dispatchEvent(new PopStateEvent('popstate'))
      }
      return
    }
    const path = mode === 'agreement' ? '/agreement' : authView === 'register' ? '/register' : '/login'
    if (location.pathname !== path) history.replaceState(null, '', path)
  }, [authView, mode, returnPath])

  useEffect(() => {
    const sync = () => {
      if (mode === 'unlocked') {
        if (['/login', '/register', '/agreement'].includes(location.pathname)) {
          history.replaceState(null, '', returnPath)
          dispatchEvent(new PopStateEvent('popstate'))
        }
        return
      }
      if (mode === 'agreement') {
        if (location.pathname !== '/agreement') history.replaceState(null, '', '/agreement')
        return
      }
      const nextView = location.pathname === '/register' ? 'register' : 'login'
      setAuthView(nextView)
      if (!['/login', '/register'].includes(location.pathname)) history.replaceState(null, '', `/${nextView}`)
    }
    addEventListener('popstate', sync)
    return () => { removeEventListener('popstate', sync) }
  }, [mode, returnPath])

  useEffect(() => {
    if (mode === 'unlocked') return undefined
    const root = document.getElementById('root')
    if (root === null) return undefined
    const previous = root.inert
    const previouslyHidden = root.hidden
    root.inert = true
    root.hidden = true
    return () => {
      root.inert = previous
      root.hidden = previouslyHidden
    }
  }, [mode])

  const required = state?.agreements.required_acknowledgements ?? []
  const allAccepted = useMemo(
    () => required.length > 0 && required.every(id => accepted.has(id)),
    [accepted, required],
  )

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !identifier.trim() || !password || state?.ready !== true) return
    setBusy(true)
    setError(null)
    try {
      const result = await callIdentity('session.login', {
        identifier: identifier.trim(),
        password,
        remember_login: rememberLogin,
      })
      setPassword('')
      if (!result.ok) throw new Error(result.error?.message ?? '登录失败。')
      if (!validBootstrap(result.value)) throw new Error('企业身份服务返回了无效登录状态。')
      history.replaceState(null, '', returnPath)
      location.reload()
    } catch (loginError) {
      setPassword('')
      setError(errorMessage(loginError))
    } finally {
      setBusy(false)
    }
  }


  const issueChallenge = async (clearError = true) => {
    if (challengeBusy || state?.ready !== true) return
    setChallengeBusy(true)
    if (clearError) setError(null)
    try {
      const result = await callIdentity('verification.issue', { purpose: 'registration' })
      if (!result.ok) throw new Error(result.error?.message ?? '验证码获取失败。')
      const value = result.value as Partial<RegistrationChallenge> | null
      if (value === null
        || value.schema_version !== 1
        || typeof value.challenge_id !== 'string'
        || typeof value.image_data_url !== 'string'
        || typeof value.expires_at !== 'string') {
        throw new Error('企业身份服务返回了无效验证码。')
      }
      setChallenge(value as RegistrationChallenge)
      setVerificationCode('')
    } catch (challengeError) {
      setChallenge(null)
      setError(errorMessage(challengeError))
    } finally {
      setChallengeBusy(false)
    }
  }

  useEffect(() => {
    if (mode === 'login' && authView === 'register' && state?.ready === true && challenge === null && registration === null) {
      void issueChallenge(false)
    }
  }, [authView, challenge, mode, registration, state?.ready])

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy
      || challenge === null
      || !account.trim()
      || !realName.trim()
      || registrationPassword.length < 10
      || !verificationCode.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await callIdentity('session.register', {
        account: account.trim(),
        real_name: realName.trim(),
        password: registrationPassword,
        challenge_id: challenge.challenge_id,
        verification_code: verificationCode.trim(),
      })
      setRegistrationPassword('')
      setVerificationCode('')
      if (!result.ok) throw new Error(result.error?.message ?? '注册提交失败。')
      const value = result.value as Partial<RegistrationReceipt> | null
      if (value === null
        || value.schema_version !== 1
        || value.status !== 'pending_approval'
        || typeof value.registration_id !== 'string') {
        throw new Error('企业身份服务返回了无效注册凭证。')
      }
      setRegistration(value as RegistrationReceipt)
      setChallenge(null)
      setIdentifier(account.trim())
    } catch (registrationError) {
      setRegistrationPassword('')
      setVerificationCode('')
      setChallenge(null)
      setError(errorMessage(registrationError))
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    if (busy || !allAccepted || state === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await callIdentity('agreements.accept', {
        bundle_sha256: state.agreements.bundle_sha256,
        acknowledgements: [...required],
      })
      if (!result.ok) throw new Error(result.error?.message ?? '协议归档失败。')
      if (!validBootstrap(result.value)
        || !result.value.workspace_unlocked
        || typeof result.value.agreement_receipt_id !== 'string') {
        throw new Error('企业服务器未返回有效的协议归档凭证。')
      }
      history.replaceState(null, '', returnPath)
      location.reload()
    } catch (acceptError) {
      setError(errorMessage(acceptError))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'unlocked') return null

  if (mode === 'agreement' && state !== null) {
    return createPortal(
      <main className={css.gate} data-emate-identity-gate="agreement">
        <section className={css.agreementPanel} aria-labelledby="emate-agreement-title">
          <header className={css.agreementHeader}>
            <img src="/assets/e-mate/logo.png" alt="e-Mate" />
            <div>
              <h1 id="emate-agreement-title">首次使用协议确认</h1>
              <p>请阅读并确认以下文件。只有企业服务器归档成功后才会打开本地工作区。</p>
            </div>
          </header>
          <div className={css.documents}>
            {state.agreements.documents.map(document => (
              <article key={document.id} aria-labelledby={`agreement-${document.id}`}>
                <h2 id={`agreement-${document.id}`}>{document.title}</h2>
                <small>版本 {document.version} · SHA-256 {document.sha256}</small>
                <pre>{document.markdown}</pre>
              </article>
            ))}
          </div>
          <div className={css.confirmations}>
            <p>签署主体：{state.agreements.provider_legal_name}</p>
            {state.agreements.acknowledgements.map(item => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={accepted.has(item.id)}
                  disabled={busy}
                  onChange={event => setAccepted(previous => {
                    const next = new Set(previous)
                    if (event.target.checked) next.add(item.id)
                    else next.delete(item.id)
                    return next
                  })}
                />
                <span>{item.label}</span>
              </label>
            ))}
            {error && <p className={css.error} role="alert">{error}</p>}
            <button className={css.primaryButton} type="button" disabled={busy || !allAccepted} aria-busy={busy} onClick={() => { void accept() }}>
              {busy ? '正在提交归档' : '同意并进入 e-Mate'}
            </button>
          </div>
        </section>
      </main>,
      document.body,
    )
  }

  return createPortal(
    <main className={css.gate} data-emate-identity-gate="login">
      <section className={css.loginPanel} aria-labelledby="emate-login-title">
        <img className={css.logo} src="/assets/e-mate/logo.png" alt="e-Mate" />
        {state?.ready !== true ? (
          <div className={css.blocked}>
            <h1 id="emate-login-title">登录服务尚未就绪</h1>
            <p>{state?.blocker ?? error ?? '正在验证企业身份服务…'}</p>
            <button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void load() }}>重新检查</button>
          </div>
        ) : authView === 'register' && registration !== null ? (
          <div className={css.pending} role="status">
            <h1 id="emate-login-title">注册申请已提交</h1>
            <p>管理员审核真实姓名并设置每周 Token 用量后，即可使用账号登录。</p>
            <small>申请编号 {registration.registration_id}</small>
            <button className={css.primaryButton} type="button" onClick={() => { setAuthView('login'); setError(null) }}>返回登录</button>
          </div>
        ) : authView === 'register' ? (
          <form className={css.loginForm} onSubmit={event => { void register(event) }}>
            <h1 id="emate-login-title" className={css.visuallyHidden}>注册 e-Mate</h1>
            <label><span>账号</span><input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={128} value={account} disabled={busy} onChange={event => { setAccount(event.target.value); if (error) setError(null) }} /></label>
            <label><span>真实姓名</span><input type="text" autoComplete="name" minLength={2} maxLength={128} value={realName} disabled={busy} onChange={event => { setRealName(event.target.value); if (error) setError(null) }} /></label>
            <label><span>密码（至少 10 位）</span><input type="password" autoComplete="new-password" minLength={10} maxLength={256} value={registrationPassword} disabled={busy} onChange={event => { setRegistrationPassword(event.target.value); if (error) setError(null) }} /></label>
            <label><span>验证码</span><span className={css.captchaRow}><input type="text" inputMode="text" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={4} maxLength={12} value={verificationCode} disabled={busy || challenge === null} onChange={event => { setVerificationCode(event.target.value); if (error) setError(null) }} />{challenge && <img className={css.captchaImage} src={challenge.image_data_url} alt="注册验证码" />}</span></label>
            <button className={css.secondaryButton} type="button" disabled={busy || challengeBusy} onClick={() => { void issueChallenge() }}>{challengeBusy ? '正在获取验证码' : '换一张验证码'}</button>
            {error && <p className={css.error} role="alert">{error}</p>}
            <button className={css.primaryButton} type="submit" disabled={busy || challenge === null || !account.trim() || !realName.trim() || registrationPassword.length < 10 || !verificationCode.trim()} aria-busy={busy}>{busy ? '正在提交注册' : '提交注册申请'}</button>
            <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { setAuthView('login'); setError(null) }}>已有账号，返回登录</button>
          </form>
        ) : (
          <form className={css.loginForm} onSubmit={event => { void login(event) }}>
            <h1 id="emate-login-title" className={css.visuallyHidden}>登录 e-Mate</h1>
            <label><span>账号或邮箱</span><input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={identifier} disabled={busy} onChange={event => { setIdentifier(event.target.value); if (error) setError(null) }} /></label>
            <label><span>密码</span><input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => { setPassword(event.target.value); if (error) setError(null) }} /></label>
            <label className={css.remember}><input type="checkbox" checked={rememberLogin} disabled={busy} onChange={event => setRememberLogin(event.target.checked)} /><span>保持登录</span></label>
            {error && <p className={css.error} role="alert">{error}</p>}
            <button className={css.primaryButton} type="submit" disabled={busy || !identifier.trim() || !password} aria-busy={busy}>{busy ? '正在进入 e-Mate' : '登录'}</button>
            <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { setAuthView('register'); setError(null); setRegistration(null) }}>注册新账号</button>
          </form>
        )}
      </section>
    </main>,
    document.body,
  )
}
